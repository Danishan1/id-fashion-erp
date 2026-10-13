import { beforeEach, describe, expect, it, vi } from "vitest";

const { findManyMock } = vi.hoisted(() => ({ findManyMock: vi.fn() }));
vi.mock("@/core/db/client", () => ({ prisma: { supportAccessEvent: { findMany: findManyMock } } }));

const { computeSupportEventHash, verifySupportEventChain } = await import("./support-events");

function buildChain(count: number) {
  const events = [];
  let prevHash: string | null = null;
  for (let seq = 1; seq <= count; seq++) {
    const fields = {
      prevHash,
      seq,
      eventType: "ACCESS",
      actorType: "PLATFORM_USER",
      actorId: "op-1",
      method: "GET",
      path: `/dashboard?page=${seq}`,
      detail: { b: 2, a: 1 },
      createdAt: new Date(1_700_000_000_000 + seq * 1000),
    };
    const hash = computeSupportEventHash(fields);
    events.push({ ...fields, hash });
    prevHash = hash;
  }
  return events;
}

beforeEach(() => findManyMock.mockReset());

describe("support event hash chain", () => {
  it("is independent of JSON key order", () => {
    const base = {
      prevHash: null,
      seq: 1,
      eventType: "X",
      actorType: "SYSTEM",
      actorId: null,
      method: null,
      path: null,
      createdAt: new Date(0),
    };
    expect(computeSupportEventHash({ ...base, detail: { a: 1, b: 2 } })).toBe(
      computeSupportEventHash({ ...base, detail: { b: 2, a: 1 } })
    );
  });

  it("verifies an untouched chain", async () => {
    findManyMock.mockResolvedValue(buildChain(5));
    await expect(verifySupportEventChain("req-1")).resolves.toEqual({ valid: true, eventCount: 5, brokenAtSeq: null });
  });

  it("detects an edited event", async () => {
    const chain = buildChain(5);
    chain[2] = { ...chain[2], path: "/something-else" };
    findManyMock.mockResolvedValue(chain);
    await expect(verifySupportEventChain("req-1")).resolves.toMatchObject({ valid: false, brokenAtSeq: 3 });
  });

  it("detects a deleted event", async () => {
    const chain = buildChain(5);
    chain.splice(1, 1);
    findManyMock.mockResolvedValue(chain);
    await expect(verifySupportEventChain("req-1")).resolves.toMatchObject({ valid: false, brokenAtSeq: 3 });
  });
});
