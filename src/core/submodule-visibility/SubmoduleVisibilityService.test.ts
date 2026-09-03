import { beforeEach, describe, expect, it, vi } from "vitest";

const { findManyMock, upsertMock, hasDataMocks } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  upsertMock: vi.fn(),
  hasDataMocks: {
    FABRIC_GSM: vi.fn(),
    FABRIC_DYE: vi.fn(),
    FABRIC_DYE_TYPE: vi.fn(),
    FABRIC_WEAVE_TYPE: vi.fn(),
    FABRIC_WIDTH: vi.fn(),
    FABRIC_COMPOSITION: vi.fn(),
  },
}));

vi.mock("@/core/db/client", () => ({
  prisma: {
    submoduleVisibility: {
      findMany: findManyMock,
      upsert: upsertMock,
    },
  },
}));

vi.mock("./submodule-data-checks", () => ({
  SUBMODULE_HAS_DATA_CHECKS: hasDataMocks,
}));

const { getSubmoduleVisibilityMap, setSubmoduleVisibility, clearSubmoduleVisibilityCache } = await import(
  "./SubmoduleVisibilityService"
);

const COMPANY_A = "company-a";
const COMPANY_B = "company-b";

function resetAllHasDataMocks(value: boolean) {
  for (const fn of Object.values(hasDataMocks)) {
    fn.mockReset().mockResolvedValue(value);
  }
}

beforeEach(() => {
  findManyMock.mockReset().mockResolvedValue([]);
  upsertMock.mockReset();
  resetAllHasDataMocks(false);
  clearSubmoduleVisibilityCache();
});

describe("getSubmoduleVisibilityMap", () => {
  it("defaults every submodule to visible when no row exists and no data exists", async () => {
    const map = await getSubmoduleVisibilityMap(COMPANY_A);

    expect(map.FABRIC_GSM).toEqual({ isVisible: true, isLocked: false });
    expect(map.FABRIC_DYE).toEqual({ isVisible: true, isLocked: false });
  });

  it("honors a stored hidden row when the submodule has no data", async () => {
    findManyMock.mockResolvedValue([{ submoduleKey: "FABRIC_WEAVE_TYPE", isVisible: false }]);

    const map = await getSubmoduleVisibilityMap(COMPANY_A);

    expect(map.FABRIC_WEAVE_TYPE).toEqual({ isVisible: false, isLocked: false });
    expect(map.FABRIC_GSM).toEqual({ isVisible: true, isLocked: false });
  });

  it("forces isVisible true once a submodule has real data, even if a stale hidden row is stored (the race-closure)", async () => {
    findManyMock.mockResolvedValue([{ submoduleKey: "FABRIC_DYE", isVisible: false }]);
    hasDataMocks.FABRIC_DYE.mockResolvedValue(true);

    const map = await getSubmoduleVisibilityMap(COMPANY_A);

    expect(map.FABRIC_DYE).toEqual({ isVisible: true, isLocked: true });
  });

  it("caches the lock map briefly per company and doesn't re-run existence checks within the TTL", async () => {
    await getSubmoduleVisibilityMap(COMPANY_A);
    await getSubmoduleVisibilityMap(COMPANY_A);

    expect(hasDataMocks.FABRIC_GSM).toHaveBeenCalledTimes(1);
  });

  it("keeps each company's lock cache independent", async () => {
    hasDataMocks.FABRIC_GSM.mockResolvedValue(true);
    await getSubmoduleVisibilityMap(COMPANY_A);

    hasDataMocks.FABRIC_GSM.mockResolvedValue(false);
    const mapB = await getSubmoduleVisibilityMap(COMPANY_B);

    expect(mapB.FABRIC_GSM.isLocked).toBe(false);
  });
});

describe("setSubmoduleVisibility", () => {
  it("throws NOT_FOUND for an unregistered key", async () => {
    await expect(setSubmoduleVisibility(COMPANY_A, "NOT_A_REAL_KEY", false)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("throws SUBMODULE_LOCKED and never writes when the submodule already has data", async () => {
    hasDataMocks.FABRIC_WIDTH.mockResolvedValue(true);

    await expect(setSubmoduleVisibility(COMPANY_A, "FABRIC_WIDTH", false)).rejects.toMatchObject({
      code: "SUBMODULE_LOCKED",
    });
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("upserts and invalidates the cache when the submodule has no data", async () => {
    // Warm the cache first so we can prove it gets invalidated, not just unused.
    await getSubmoduleVisibilityMap(COMPANY_A);
    expect(hasDataMocks.FABRIC_WIDTH).toHaveBeenCalledTimes(1);

    await setSubmoduleVisibility(COMPANY_A, "FABRIC_WIDTH", false);

    expect(upsertMock).toHaveBeenCalledWith({
      where: { companyId_submoduleKey: { companyId: COMPANY_A, submoduleKey: "FABRIC_WIDTH" } },
      update: { isVisible: false },
      create: { companyId: COMPANY_A, submoduleKey: "FABRIC_WIDTH", isVisible: false },
    });

    // A read right after the write should re-run the existence checks, not
    // reuse the pre-write cache entry.
    await getSubmoduleVisibilityMap(COMPANY_A);
    expect(hasDataMocks.FABRIC_WIDTH).toHaveBeenCalledTimes(3);
  });
});
