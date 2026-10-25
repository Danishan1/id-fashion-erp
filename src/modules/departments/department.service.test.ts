import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("./department.repository", () => ({
  DepartmentRepository: {
    findMany: vi.fn(),
    count: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

const { writeAuditLog } = await import("@/core/audit/AuditLogger");
const { DepartmentRepository } = await import("./department.repository");
const {
  listDepartments,
  getDepartmentById,
  createDepartment,
  updateDepartment,
} = await import("./department.service");

const actor = { companyId: "co-1", userId: "user-1" };

beforeEach(() => {
  vi.mocked(writeAuditLog).mockReset();
  vi.mocked(DepartmentRepository.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(DepartmentRepository.count).mockReset().mockResolvedValue(0);
  vi.mocked(DepartmentRepository.findFirst).mockReset().mockResolvedValue(null);
  vi.mocked(DepartmentRepository.create).mockReset();
  vi.mocked(DepartmentRepository.update).mockReset();
});

describe("Department Service (Unit Tests)", () => {
  const query = {
    search: "Cutting",
    sortBy: "name",
    sortOrder: "asc" as const,
    page: 1,
    pageSize: 10,
    skip: 0,
    take: 10,
  };

  it("lists departments applying search and pagination", async () => {
    const rows = [{ id: "dept-1", code: "CUT", name: "Cutting Department", companyId: "co-1" }];
    vi.mocked(DepartmentRepository.findMany).mockResolvedValue(rows as never);
    vi.mocked(DepartmentRepository.count).mockResolvedValue(1);

    const result = await listDepartments("co-1", query);

    expect(result).toEqual({ data: rows, totalCount: 1 });
    expect(DepartmentRepository.findMany).toHaveBeenCalledWith({
      where: {
        companyId: "co-1",
        OR: [
          { name: { contains: "Cutting", mode: "insensitive" } },
          { code: { contains: "Cutting", mode: "insensitive" } },
        ],
      },
      orderBy: { name: "asc" },
      skip: 0,
      take: 10,
    });
  });

  it("gets a department by ID within the company scope", async () => {
    const dept = { id: "dept-1", code: "CUT", name: "Cutting Department", companyId: "co-1" };
    vi.mocked(DepartmentRepository.findFirst).mockResolvedValue(dept as never);

    const result = await getDepartmentById("co-1", "dept-1");
    expect(result).toEqual(dept);
    expect(DepartmentRepository.findFirst).toHaveBeenCalledWith({
      where: { id: "dept-1", companyId: "co-1" },
    });
  });

  it("throws NOT_FOUND when department does not exist or belongs to another company", async () => {
    vi.mocked(DepartmentRepository.findFirst).mockResolvedValue(null);

    await expect(getDepartmentById("co-1", "dept-other")).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Department not found.",
    });
  });

  it("creates a department and writes audit log", async () => {
    const created = { id: "dept-1", code: "STITCH", name: "Stitching", companyId: "co-1" };
    vi.mocked(DepartmentRepository.create).mockResolvedValue(created as never);

    const result = await createDepartment(actor, { code: "STITCH", name: "Stitching" });

    expect(result).toEqual(created);
    expect(DepartmentRepository.create).toHaveBeenCalledWith({
      data: { companyId: "co-1", code: "STITCH", name: "Stitching" },
    });
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "co-1",
        userId: "user-1",
        tableName: "departments",
        recordId: "dept-1",
        action: "CREATE",
      })
    );
  });

  it("rejects creation if department code already exists in the same company", async () => {
    vi.mocked(DepartmentRepository.findFirst).mockResolvedValue({ id: "dept-old", code: "STITCH" } as never);

    await expect(createDepartment(actor, { code: "STITCH", name: "Stitching" })).rejects.toMatchObject({
      code: "DUPLICATE_DOC_NUMBER",
      message: 'Department code "STITCH" is already in use.',
    });
    expect(DepartmentRepository.create).not.toHaveBeenCalled();
  });

  it("updates department without code change and writes audit log", async () => {
    const existing = { id: "dept-1", code: "STITCH", name: "Old Stitching", companyId: "co-1" };
    const updated = { ...existing, name: "New Stitching Department" };

    vi.mocked(DepartmentRepository.findFirst).mockResolvedValue(existing as never);
    vi.mocked(DepartmentRepository.update).mockResolvedValue(updated as never);

    const result = await updateDepartment(actor, "dept-1", { code: "STITCH", name: "New Stitching Department" });

    expect(result).toEqual(updated);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "co-1",
        userId: "user-1",
        tableName: "departments",
        recordId: "dept-1",
        action: "UPDATE",
        oldValues: existing,
        newValues: updated,
      })
    );
  });

  it("rejects updating code if the new code is already in use by another department in company", async () => {
    const existing = { id: "dept-1", code: "CUT", name: "Cutting", companyId: "co-1" };
    vi.mocked(DepartmentRepository.findFirst)
      .mockResolvedValueOnce(existing as never) // getDepartmentById
      .mockResolvedValueOnce({ id: "dept-2", code: "STITCH", companyId: "co-1" } as never); // codeInUse check

    await expect(updateDepartment(actor, "dept-1", { code: "STITCH", name: "Cutting" })).rejects.toMatchObject({
      code: "DUPLICATE_DOC_NUMBER",
      message: 'Department code "STITCH" is already in use.',
    });
    expect(DepartmentRepository.update).not.toHaveBeenCalled();
  });
});
