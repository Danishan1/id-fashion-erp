export interface ListQuery {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
  search?: string;
  sortBy: string;
  sortOrder: "asc" | "desc";
}

export function parseListQuery(searchParams: URLSearchParams, defaultSortBy = "createdAt"): ListQuery {
  const page = Math.max(1, Number(searchParams.get("page") ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") ?? 20) || 20));
  const search = searchParams.get("search")?.trim() || undefined;
  const sortBy = searchParams.get("sortBy") ?? defaultSortBy;
  const sortOrder = searchParams.get("sortOrder") === "asc" ? "asc" : "desc";

  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize, search, sortBy, sortOrder };
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
