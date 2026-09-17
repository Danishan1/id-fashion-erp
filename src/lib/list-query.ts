export interface ListQuery {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
  search?: string;
  sortBy: string;
  sortOrder: "asc" | "desc";
  /**
   * Raw `?status=` value, parsed generically here so every list route gets
   * it for free — but never trusted as-is against Prisma. A service that
   * wants to filter by it must validate against its own real status enum
   * first (`Object.values(XStatus)`, the same "runtime enum object is the
   * one source of truth" convention already used by Sampling's own
   * comma-separated status filter) before adding it to a `where` clause,
   * since this file has no knowledge of which enum a given model uses.
   */
  status?: string;
}

export function parseListQuery(searchParams: URLSearchParams, defaultSortBy = "createdAt"): ListQuery {
  const page = Math.max(1, Number(searchParams.get("page") ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") ?? 20) || 20));
  const search = searchParams.get("search")?.trim() || undefined;
  const sortBy = searchParams.get("sortBy") ?? defaultSortBy;
  const sortOrder = searchParams.get("sortOrder") === "asc" ? "asc" : "desc";
  const status = searchParams.get("status")?.trim() || undefined;

  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize, search, sortBy, sortOrder, status };
}

export interface ListMeta {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

export function buildListMeta(totalCount: number, page: number, pageSize: number): ListMeta {
  return { page, pageSize, totalCount, totalPages: Math.max(1, Math.ceil(totalCount / pageSize)) };
}
