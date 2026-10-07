"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { crmRequest } from "@/components/crm/crm-api";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { toast } from "@/components/ui/Toast";

/**
 * Shared CRM Kanban board (Phase 08, reused by the Lead board): server-loaded
 * columns, per-column "Load more", HTML5 drag and drop with an optimistic move
 * that is put back exactly where it was when the server refuses, and one
 * dialog for refusals. It never decides whether a move is allowed — `onMove`
 * calls the entity's own API and the server's answer is shown as is.
 */
export interface KanbanColumn<T> {
  id: string;
  name: string;
  count: number;
  records: T[];
  hasMore: boolean;
  archived?: boolean;
}
export type KanbanNotice =
  | { kind: "blocked"; reasons: { code: string; message: string }[]; missingFields: { key: string; label: string }[] }
  | { kind: "conflict" }
  | { kind: "error"; message: string };
/** ok → the board reloads from the server; not ok → the card is put back (notice null = silently, e.g. another dialog takes over). */
export type KanbanMoveResult = { ok: true; message?: string } | { ok: false; notice: KanbanNotice | null };

/** The chosen fields of one card; empty values are skipped. */
export function CardFieldList<T>({ fields, record }: { fields: { key: string; header: string; render: (r: T) => ReactNode }[]; record: T }) {
  if (!fields.length) return null;
  return (
    <dl className="mt-1.5 space-y-0.5 text-xs">
      {fields.map((f) => {
        const value = f.render(record);
        if (value === null || value === undefined || value === "") return null;
        return (
          <div key={f.key} className="flex gap-2">
            <dt className="w-24 shrink-0 text-zinc-400">{f.header}</dt>
            <dd className="min-w-0 flex-1 break-words text-zinc-700 dark:text-zinc-200">{value}</dd>
          </div>
        );
      })}
    </dl>
  );
}
export const conflictMessage = (noun: string) => `This ${noun.toLowerCase()} was updated by another user. Please refresh and try again.`;

type Card = { id: string };

function withoutCard<T extends Card>(cols: KanbanColumn<T>[], id: string) {
  return cols.map((c) => (c.records.some((r) => r.id === id) ? { ...c, records: c.records.filter((r) => r.id !== id), count: Math.max(0, c.count - 1) } : c));
}
function withCard<T extends Card>(cols: KanbanColumn<T>[], columnId: string, record: T, index = 0) {
  return cols.map((c) => {
    if (c.id !== columnId) return c;
    const records = [...c.records];
    records.splice(Math.min(index, records.length), 0, record);
    return { ...c, records, count: c.count + 1 };
  });
}

export function CrmKanbanBoard<T extends Card, C extends KanbanColumn<T>>({
  query,
  columnsOf,
  pageQuery,
  reloadKey = 0,
  canDrag,
  columnNoun,
  recordNoun,
  recordNounPlural,
  recordHref,
  cardTitle,
  renderHeader,
  renderCard,
  onMove,
  optimistic = (card) => card,
  renderSummary,
  emptyMessage,
}: {
  /** Board URL (null while not ready). Changing it reloads the board. */
  query: string | null;
  columnsOf: (data: unknown) => C[];
  /** URL for the next page of one column. */
  pageQuery: (column: C, offset: number) => string;
  /** Bump to reload (e.g. after a dialog changed a record). */
  reloadKey?: number;
  canDrag: boolean;
  /** "stage" / "status" — used in labels. */
  columnNoun: string;
  /** "Opportunity" / "Lead". */
  recordNoun: string;
  /** "opportunities" / "leads". */
  recordNounPlural: string;
  recordHref: (card: T) => string;
  cardTitle: (card: T) => string;
  renderHeader: (column: C) => ReactNode;
  /** Card content (title row, fields, action menu); the board supplies the draggable wrapper. */
  renderCard: (card: T, column: C, saving: boolean) => ReactNode;
  onMove: (card: T, from: C, to: C) => Promise<KanbanMoveResult>;
  /** The card as shown in its new column while the server decides. */
  optimistic?: (card: T, to: C) => T;
  renderSummary?: (columns: C[]) => ReactNode;
  emptyMessage: string;
}) {
  const [state, setState] = useState<{ query: string; columns: C[] | null; error: string | null } | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!query) return;
    let cancelled = false;
    crmRequest<unknown>(query, { toast: "off" }).then((res) => {
      if (cancelled) return;
      setState(res.ok ? { query, columns: columnsOf(res.data), error: null } : (s) => ({ query, columns: s?.query === query ? s.columns : null, error: res.error.message }));
    });
    return () => {
      cancelled = true;
    };
    // columnsOf is a pure mapper supplied by the caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, tick, reloadKey]);
  const reload = () => setTick((t) => t + 1);
  const loading = Boolean(query) && state?.query !== query;
  const columns = state?.query === query ? state.columns : null;
  const loadError = state?.query === query ? state.error : null;
  const setColumns = (fn: (cols: C[]) => KanbanColumn<T>[]) => setState((s) => (s?.columns ? { ...s, columns: fn(s.columns) as C[] } : s));

  const [loadingMore, setLoadingMore] = useState<string | null>(null);
  const loadMore = async (column: C) => {
    setLoadingMore(column.id);
    const res = await crmRequest<unknown>(pageQuery(column, column.records.length), { toast: "off" });
    setLoadingMore(null);
    if (!res.ok) return toast.error(res.error.message);
    const next = columnsOf(res.data).find((c) => c.id === column.id);
    if (!next) return;
    setColumns((cols) => cols.map((c) => (c.id === column.id ? { ...c, records: [...c.records, ...next.records.filter((r) => !c.records.some((x) => x.id === r.id))], hasMore: next.hasMore, count: next.count } : c)));
  };

  const [dragging, setDragging] = useState<{ id: string; fromId: string } | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<{ notice: KanbanNotice; card: T; toName: string } | null>(null);

  const moveCard = async (cardId: string, fromId: string, toId: string) => {
    if (!columns || fromId === toId || pending.has(cardId)) return;
    const from = columns.find((c) => c.id === fromId);
    const to = columns.find((c) => c.id === toId);
    const index = from?.records.findIndex((r) => r.id === cardId) ?? -1;
    if (!from || !to || index < 0) return;
    const card = from.records[index];
    setColumns((cols) => withCard(withoutCard(cols, cardId), toId, optimistic(card, to)));
    setPending((p) => new Set(p).add(cardId));
    let result: KanbanMoveResult;
    try {
      result = await onMove(card, from, to);
    } catch {
      result = { ok: false, notice: { kind: "error", message: "Couldn't reach the server. Check your connection and try again." } };
    }
    setPending((p) => {
      const n = new Set(p);
      n.delete(cardId);
      return n;
    });
    if (!result.ok) {
      // Put the card back exactly where it was.
      setColumns((cols) => withCard(withoutCard(cols, cardId), fromId, card, index));
      if (result.notice) setNotice({ notice: result.notice, card, toName: to.name });
      return;
    }
    toast.success(result.message ?? `Moved "${cardTitle(card)}" to ${to.name}.`);
    reload();
  };

  const [mobileId, setMobileId] = useState<string | null>(null);
  const cols = columns ?? [];
  const total = cols.reduce((n, c) => n + c.count, 0);
  const mobileColumn = cols.find((c) => c.id === mobileId)?.id ?? cols[0]?.id;
  const Noun = columnNoun.charAt(0).toUpperCase() + columnNoun.slice(1);

  return (
    <div className="space-y-3">
      {columns && renderSummary?.(columns)}
      {loading && !columns && <div className="rounded-lg border border-zinc-200 p-8 text-center text-sm text-zinc-500 dark:border-zinc-800">Loading board…</div>}
      {loadError && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <span>Couldn&apos;t load the board: {loadError}</span>
          <Button size="xs" variant="secondary" onClick={reload}>
            Try again
          </Button>
        </div>
      )}
      {columns && total === 0 && <p className="rounded-md bg-zinc-50 px-3 py-2 text-sm text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400">{emptyMessage}</p>}

      {columns && cols.length > 0 && (
        <>
          <div className="md:hidden">
            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400" htmlFor="board-mobile-column">
              {Noun}
            </label>
            <select id="board-mobile-column" value={mobileColumn ?? ""} onChange={(e) => setMobileId(e.target.value)} className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800">
              {cols.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.count})
                </option>
              ))}
            </select>
          </div>
          <div className={`flex gap-3 overflow-x-auto pb-3 ${loading ? "opacity-70" : ""}`} aria-busy={loading}>
            {cols.map((column) => (
              <section
                key={column.id}
                aria-label={`${column.name} ${columnNoun}`}
                data-stage-id={column.id}
                onDragOver={(e) => {
                  if (!dragging || !canDrag) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (overId !== column.id) setOverId(column.id);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOverId((s) => (s === column.id ? null : s));
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setOverId(null);
                  const id = e.dataTransfer.getData("text/plain") || dragging?.id;
                  const fromId = dragging?.fromId ?? cols.find((c) => c.records.some((r) => r.id === id))?.id;
                  setDragging(null);
                  if (id && fromId && canDrag) void moveCard(id, fromId, column.id);
                }}
                className={`${column.id === mobileColumn ? "flex" : "hidden"} w-full shrink-0 flex-col rounded-lg border bg-zinc-50 md:flex md:w-72 dark:bg-zinc-900/60 ${
                  overId === column.id ? "border-indigo-400 ring-2 ring-indigo-300 dark:border-indigo-500" : "border-zinc-200 dark:border-zinc-800"
                }`}
              >
                <header className="border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="truncate text-sm font-semibold text-zinc-800 dark:text-zinc-100" title={column.name}>
                      {column.name}
                      {column.archived && <span className="ml-1 text-xs font-normal text-amber-600"> (archived)</span>}
                    </h3>
                    <span className="rounded-full bg-zinc-200 px-2 text-xs font-medium text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200" aria-label={`${column.count} ${recordNounPlural}`}>
                      {column.count}
                    </span>
                  </div>
                  {renderHeader(column)}
                </header>
                <ul className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto p-2 md:max-h-[65vh]">
                  {column.records.map((card) => {
                    const saving = pending.has(card.id);
                    return (
                      <li
                        key={card.id}
                        draggable={canDrag && !saving}
                        aria-busy={saving}
                        data-card-id={card.id}
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/plain", card.id);
                          e.dataTransfer.effectAllowed = "move";
                          setDragging({ id: card.id, fromId: column.id });
                        }}
                        onDragEnd={() => {
                          setDragging(null);
                          setOverId(null);
                        }}
                        className={`rounded-md border border-zinc-200 bg-white p-2.5 text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-800 ${canDrag ? "cursor-grab active:cursor-grabbing" : ""} ${saving ? "opacity-60" : ""} ${
                          dragging?.id === card.id ? "ring-2 ring-indigo-300" : ""
                        }`}
                      >
                        {renderCard(card, column, saving)}
                      </li>
                    );
                  })}
                  {column.records.length === 0 && (
                    <li className="py-6 text-center text-xs text-zinc-400">
                      {canDrag ? `No ${recordNounPlural} — drop one here` : `No ${recordNounPlural}`}
                    </li>
                  )}
                </ul>
                {column.hasMore && (
                  <div className="border-t border-zinc-200 p-2 dark:border-zinc-800">
                    <Button size="xs" variant="secondary" className="w-full" onClick={() => loadMore(column)} isLoading={loadingMore === column.id}>
                      Load more ({column.count - column.records.length})
                    </Button>
                  </div>
                )}
              </section>
            ))}
          </div>
        </>
      )}

      <Modal
        open={notice !== null}
        onClose={() => setNotice(null)}
        title={notice?.notice.kind === "blocked" ? `Can't move to ${notice.toName}` : notice?.notice.kind === "conflict" ? `${recordNoun} changed` : `Couldn't move the ${recordNoun.toLowerCase()}`}
      >
        {notice && (
          <div className="mt-3 space-y-3 text-sm">
            <p className="font-medium text-zinc-800 dark:text-zinc-100">{cardTitle(notice.card)}</p>
            {notice.notice.kind === "blocked" && (
              <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                {notice.notice.reasons
                  .filter((r) => r.code !== "REQUIRED_FIELDS_MISSING")
                  .map((r) => (
                    <p key={r.code + r.message}>{r.message}</p>
                  ))}
                {notice.notice.missingFields.length > 0 && (
                  <>
                    <p className="font-medium">Required before this {columnNoun}:</p>
                    <ul className="ml-4 list-disc">
                      {notice.notice.missingFields.map((m) => (
                        <li key={m.key}>{m.label}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
            {notice.notice.kind === "conflict" && <p role="alert">{conflictMessage(recordNoun)}</p>}
            {notice.notice.kind === "error" && <p role="alert">{notice.notice.message}</p>}
            <p className="text-xs text-zinc-500 dark:text-zinc-400">The card was left in its original {columnNoun}.</p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setNotice(null)}>
                Close
              </Button>
              {notice.notice.kind === "conflict" ? (
                <Button
                  onClick={() => {
                    setNotice(null);
                    reload();
                  }}
                >
                  Refresh board
                </Button>
              ) : (
                <Link href={recordHref(notice.card)} className={buttonClasses("primary", "sm")}>
                  Open {recordNoun}
                </Link>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
