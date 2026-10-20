"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, addMonths, startOfMonth, startOfWeek, zonedDayStart, zonedParts, zonedToInstant, formatZonedTime } from "@/modules/crm/core/crm-timezone";

/**
 * Reusable calendar (Phase 10): one component for the day, week and month
 * views over the same events, laid out in a chosen time zone. It renders and
 * reports interactions (open, empty-slot click, drag to a new time); it never
 * changes data itself — the page calls the appointment API and passes events
 * back in.
 */
export type CalendarView = "day" | "week" | "month";
export type CalendarTone = "indigo" | "green" | "amber" | "red" | "neutral";

export interface CalendarEvent {
  id: string;
  /** ISO instants. */
  start: string;
  end: string | null;
  title: string;
  /** Second line, e.g. company · contact. */
  subtitle?: string | null;
  /** Small trailing label, e.g. status or employee. */
  badge?: string | null;
  tone: CalendarTone;
  draggable?: boolean;
  /** Greyed out (cancelled / no-show). */
  muted?: boolean;
  /** Being saved (optimistic move). */
  pending?: boolean;
}

export const HOUR_PX = 48;
const SNAP_MINUTES = 15;
const DAY_MINUTES = 24 * 60;
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const TONES: Record<CalendarTone, string> = {
  indigo: "border-indigo-400 bg-indigo-50 text-indigo-900 dark:border-indigo-500 dark:bg-indigo-950/60 dark:text-indigo-100",
  green: "border-green-500 bg-green-50 text-green-900 dark:border-green-500 dark:bg-green-950/60 dark:text-green-100",
  amber: "border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-500 dark:bg-amber-950/60 dark:text-amber-100",
  red: "border-red-400 bg-red-50 text-red-900 dark:border-red-500 dark:bg-red-950/60 dark:text-red-100",
  neutral: "border-zinc-300 bg-zinc-50 text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200",
};

/** The calendar days a view shows and the instant window to load for it (in `timeZone`). */
export function calendarRange(view: CalendarView, date: string, timeZone: string, weekStartsOn = 1) {
  let days: string[];
  if (view === "day") days = [date];
  else if (view === "week") {
    const first = startOfWeek(date, weekStartsOn);
    days = Array.from({ length: 7 }, (_, i) => addDays(first, i));
  } else {
    const first = startOfWeek(startOfMonth(date), weekStartsOn);
    days = Array.from({ length: 42 }, (_, i) => addDays(first, i));
  }
  return { days, from: zonedDayStart(days[0], timeZone), to: zonedDayStart(addDays(days[days.length - 1], 1), timeZone) };
}

/** Previous / next period. */
export function shiftDate(view: CalendarView, date: string, step: 1 | -1) {
  if (view === "day") return addDays(date, step);
  if (view === "week") return addDays(date, 7 * step);
  const target = addMonths(date, step);
  // Keep the day of month where possible (31 Jan → 28 Feb).
  const day = Math.min(Number(date.slice(8, 10)), new Date(Date.UTC(Number(target.slice(0, 4)), Number(target.slice(5, 7)), 0)).getUTCDate());
  return `${target.slice(0, 8)}${String(day).padStart(2, "0")}`;
}

export function periodLabel(view: CalendarView, date: string, weekStartsOn = 1) {
  const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00.000Z`).toLocaleDateString("en-IN", { timeZone: "UTC", ...o });
  if (view === "day") return fmt(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  if (view === "month") return fmt(date, { month: "long", year: "numeric" });
  const first = startOfWeek(date, weekStartsOn);
  const last = addDays(first, 6);
  return `${fmt(first, { day: "numeric", month: "short" })} – ${fmt(last, { day: "numeric", month: "short", year: "numeric" })}`;
}

interface Segment {
  event: CalendarEvent;
  top: number;
  height: number;
  lane: number;
  lanes: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

/** Wall-clock minutes since the day's midnight for an instant on that day (DST-aware via the zone). */
function minutesOfDay(at: number, timeZone: string) {
  const p = zonedParts(at, timeZone);
  return p.hour * 60 + p.minute;
}

/** Events of one day as positioned segments; overlapping ones share the width in lanes. */
export function daySegments(events: CalendarEvent[], day: string, timeZone: string): Segment[] {
  const dayStart = zonedDayStart(day, timeZone).getTime();
  const dayEnd = zonedDayStart(addDays(day, 1), timeZone).getTime();
  const items = events
    .map((event) => {
      const s = new Date(event.start).getTime();
      const e = event.end ? new Date(event.end).getTime() : s + 30 * 60_000;
      if (e <= dayStart || s >= dayEnd) return null;
      const from = s < dayStart ? 0 : minutesOfDay(s, timeZone);
      const to = e >= dayEnd ? DAY_MINUTES : Math.max(minutesOfDay(e, timeZone), from + 15);
      return { event, from, to, continuesBefore: s < dayStart, continuesAfter: e > dayEnd };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x))
    .sort((a, b) => a.from - b.from || b.to - a.to);
  // Greedy lanes within clusters of overlapping events.
  const out: Segment[] = [];
  let cluster: (typeof items[number] & { lane: number })[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((c) => c.lane + 1));
    for (const c of cluster) out.push({ event: c.event, top: (c.from / 60) * HOUR_PX, height: Math.max(((c.to - c.from) / 60) * HOUR_PX, 18), lane: c.lane, lanes, continuesBefore: c.continuesBefore, continuesAfter: c.continuesAfter });
    cluster = [];
  };
  for (const it of items) {
    if (cluster.length && it.from >= clusterEnd) flush();
    const laneEnds: number[] = [];
    for (const c of cluster) laneEnds[c.lane] = Math.max(laneEnds[c.lane] ?? 0, c.to);
    let lane = laneEnds.findIndex((end) => end <= it.from);
    if (lane === -1) lane = laneEnds.length;
    cluster.push({ ...it, lane });
    clusterEnd = Math.max(clusterEnd, it.to);
  }
  if (cluster.length) flush();
  return out;
}

/** Instant for a drop at `minutes` past midnight on `day` (a time skipped by a clock change moves an hour later). */
function instantAt(day: string, minutes: number, timeZone: string) {
  const m = Math.max(0, Math.min(DAY_MINUTES - SNAP_MINUTES, minutes));
  const time = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  try {
    return zonedToInstant(day, time, timeZone);
  } catch {
    return new Date(zonedToInstant(day, `${String(Math.min(23, Math.floor(m / 60) + 1)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`, timeZone).getTime());
  }
}

export function CrmCalendar({
  view,
  date,
  timeZone,
  events,
  onEventClick,
  onSlotClick,
  onMove,
  onShowDay,
  now,
  weekStartsOn = 1,
  scrollToHour = 8,
}: {
  view: CalendarView;
  /** Focus date (YYYY-MM-DD) in `timeZone`. */
  date: string;
  timeZone: string;
  events: CalendarEvent[];
  onEventClick: (id: string) => void;
  /** Empty slot / day clicked: the date and (day / week views) the time. */
  onSlotClick?: (date: string, time: string | null) => void;
  /** An event was dropped on a new time; the page reschedules (and rolls back on failure). */
  onMove?: (id: string, start: Date, end: Date) => void;
  onShowDay?: (date: string) => void;
  now?: Date;
  weekStartsOn?: number;
  scrollToHour?: number;
}) {
  const { days } = useMemo(() => calendarRange(view, date, timeZone, weekStartsOn), [view, date, timeZone, weekStartsOn]);
  const [currentNow] = useState(() => now ?? new Date());
  const today = zonedParts(now ?? currentNow, timeZone).date;
  const drag = useRef<{ id: string; grabMinutes: number; duration: number } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  // Scroll the time grid once per period: to the working day, or earlier when an appointment starts before it.
  const scrolledFor = useRef<string | null>(null);
  const earliestMinute = useMemo(() => {
    let min = Infinity;
    for (const d of days) for (const s of daySegments(events, d, timeZone)) min = Math.min(min, (s.top / HOUR_PX) * 60);
    return min;
  }, [days, events, timeZone]);
  useEffect(() => {
    const key = `${view}|${date}|${timeZone}`;
    if (!scroller.current || view === "month") return;
    if (scrolledFor.current === key && !(earliestMinute < Infinity && scroller.current.scrollTop > (earliestMinute / 60) * HOUR_PX)) return;
    const hour = Math.min(scrollToHour, Number.isFinite(earliestMinute) ? Math.max(0, Math.floor(earliestMinute / 60) - 0.5) : scrollToHour);
    scroller.current.scrollTop = hour * HOUR_PX;
    scrolledFor.current = key;
  }, [view, date, timeZone, scrollToHour, earliestMinute]);

  const byId = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);
  const startDrag = (e: React.DragEvent, ev: CalendarEvent, grabMinutes: number) => {
    const duration = ev.end ? new Date(ev.end).getTime() - new Date(ev.start).getTime() : 30 * 60_000;
    drag.current = { id: ev.id, grabMinutes, duration };
    e.dataTransfer.setData("text/plain", ev.id);
    e.dataTransfer.effectAllowed = "move";
  };
  const dropOnTime = (e: React.DragEvent<HTMLDivElement>, day: string) => {
    e.preventDefault();
    setOver(null);
    const d = drag.current ?? (byId.get(e.dataTransfer.getData("text/plain")) ? { id: e.dataTransfer.getData("text/plain"), grabMinutes: 0, duration: 30 * 60_000 } : null);
    drag.current = null;
    if (!d || !onMove) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const minutes = ((e.clientY - rect.top) / HOUR_PX) * 60 - d.grabMinutes;
    if (!Number.isFinite(minutes)) return;
    const snapped = Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
    const start = instantAt(day, snapped, timeZone);
    const ev = byId.get(d.id);
    if (ev && start.getTime() === new Date(ev.start).getTime()) return;
    onMove(d.id, start, new Date(start.getTime() + d.duration));
  };
  const dropOnDay = (e: React.DragEvent<HTMLDivElement>, day: string) => {
    e.preventDefault();
    setOver(null);
    const id = drag.current?.id ?? e.dataTransfer.getData("text/plain");
    drag.current = null;
    const ev = byId.get(id);
    if (!ev || !onMove) return;
    // Same time of day, another date.
    const p = zonedParts(ev.start, timeZone);
    if (p.date === day) return;
    const start = instantAt(day, p.hour * 60 + p.minute, timeZone);
    const duration = ev.end ? new Date(ev.end).getTime() - new Date(ev.start).getTime() : 30 * 60_000;
    onMove(id, start, new Date(start.getTime() + duration));
  };
  const allowDrop = (e: React.DragEvent, key: string) => {
    if (!onMove || !drag.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (over !== key) setOver(key);
  };

  const eventLabel = (ev: CalendarEvent) => `${formatZonedTime(ev.start, timeZone)}${ev.end ? ` – ${formatZonedTime(ev.end, timeZone)}` : ""} ${ev.title}${ev.subtitle ? `, ${ev.subtitle}` : ""}${ev.badge ? `, ${ev.badge}` : ""}`;

  if (view === "month") {
    const month = date.slice(0, 7);
    return (
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800" role="grid" aria-label="Month">
        <div className="grid min-w-[42rem] grid-cols-7 border-b border-zinc-200 bg-zinc-50 text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400" role="row">
          {days.slice(0, 7).map((d) => (
            <div key={d} className="px-2 py-1.5" role="columnheader">
              {WEEKDAY_LABELS[new Date(`${d}T00:00:00Z`).getUTCDay()]}
            </div>
          ))}
        </div>
        <div className="grid min-w-[42rem] grid-cols-7">
          {days.map((d) => {
            const dayEvents = events.filter((ev) => {
              const s = new Date(ev.start).getTime();
              const e = ev.end ? new Date(ev.end).getTime() : s + 1;
              return s < zonedDayStart(addDays(d, 1), timeZone).getTime() && e > zonedDayStart(d, timeZone).getTime();
            });
            const shown = dayEvents.slice(0, 3);
            return (
              <div
                key={d}
                role="gridcell"
                aria-label={d}
                data-date={d}
                onDragOver={(e) => allowDrop(e, d)}
                onDragLeave={() => setOver((o) => (o === d ? null : o))}
                onDrop={(e) => dropOnDay(e, d)}
                onClick={(e) => e.target === e.currentTarget && onSlotClick?.(d, null)}
                className={`min-h-24 border-b border-r border-zinc-200 p-1 dark:border-zinc-800 ${d.slice(0, 7) === month ? "" : "bg-zinc-50/70 dark:bg-zinc-900/40"} ${over === d ? "bg-indigo-50 ring-2 ring-inset ring-indigo-300 dark:bg-indigo-950/40" : ""}`}
              >
                <button type="button" onClick={() => onShowDay?.(d)} className={`mb-0.5 rounded px-1 text-xs ${d === today ? "bg-indigo-600 font-semibold text-white" : d.slice(0, 7) === month ? "text-zinc-700 dark:text-zinc-200" : "text-zinc-400"}`}>
                  {Number(d.slice(8, 10))}
                </button>
                <ul className="space-y-0.5">
                  {shown.map((ev) => (
                    <li key={ev.id}>
                      <button
                        type="button"
                        draggable={Boolean(onMove && ev.draggable && !ev.pending)}
                        onDragStart={(e) => startDrag(e, ev, 0)}
                        onClick={() => onEventClick(ev.id)}
                        aria-label={eventLabel(ev)}
                        data-event-id={ev.id}
                        className={`block w-full truncate rounded border-l-2 px-1 text-left text-xs leading-4 ${TONES[ev.tone]} ${ev.muted ? "line-through opacity-60" : ""} ${ev.pending ? "opacity-50" : ""}`}
                      >
                        {formatZonedTime(ev.start, timeZone)} {ev.title}
                      </button>
                    </li>
                  ))}
                </ul>
                {dayEvents.length > shown.length && (
                  <button type="button" onClick={() => onShowDay?.(d)} className="mt-0.5 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                    +{dayEvents.length - shown.length} more
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const nowParts = zonedParts(now ?? currentNow, timeZone);
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <div style={{ minWidth: view === "week" ? "48rem" : undefined }}>
        <div className="flex border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="w-14 shrink-0" />
          {days.map((d) => (
            <button key={d} type="button" onClick={() => onShowDay?.(d)} className={`flex-1 px-2 py-1.5 text-left text-xs font-medium ${d === today ? "text-indigo-700 dark:text-indigo-300" : "text-zinc-600 dark:text-zinc-300"}`}>
              {WEEKDAY_LABELS[new Date(`${d}T00:00:00Z`).getUTCDay()]} {Number(d.slice(8, 10))}
            </button>
          ))}
        </div>
        <div ref={scroller} className="relative max-h-[70vh] overflow-y-auto">
          <div className="flex" style={{ height: 24 * HOUR_PX }}>
            <div className="w-14 shrink-0 select-none text-right text-xs text-zinc-400" aria-hidden>
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} style={{ height: HOUR_PX }} className="-translate-y-2 pr-2">
                  {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
                </div>
              ))}
            </div>
            {days.map((d) => (
              <div
                key={d}
                role="region"
                aria-label={`Appointments on ${d}`}
                data-date={d}
                className={`relative flex-1 border-l border-zinc-200 dark:border-zinc-800 ${over === d ? "bg-indigo-50/60 dark:bg-indigo-950/30" : ""}`}
                onDragOver={(e) => allowDrop(e, d)}
                onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOver((o) => (o === d ? null : o))}
                onDrop={(e) => dropOnTime(e, d)}
                onClick={(e) => {
                  if (e.target !== e.currentTarget || !onSlotClick) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const minutes = Math.floor((((e.clientY - rect.top) / HOUR_PX) * 60) / 30) * 30;
                  onSlotClick(d, `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`);
                }}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} style={{ top: h * HOUR_PX, height: HOUR_PX }} className="pointer-events-none absolute inset-x-0 border-t border-zinc-100 dark:border-zinc-800/70" />
                ))}
                {d === today && <div aria-hidden className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-red-500" style={{ top: ((nowParts.hour * 60 + nowParts.minute) / 60) * HOUR_PX }} />}
                {daySegments(events, d, timeZone).map((s) => (
                  <button
                    key={s.event.id}
                    type="button"
                    data-event-id={s.event.id}
                    aria-label={eventLabel(s.event)}
                    draggable={Boolean(onMove && s.event.draggable && !s.event.pending)}
                    onDragStart={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const grab = ((e.clientY - rect.top) / HOUR_PX) * 60;
                      startDrag(e, s.event, s.continuesBefore || !Number.isFinite(grab) ? 0 : grab);
                    }}
                    onDragEnd={() => setOver(null)}
                    onClick={() => onEventClick(s.event.id)}
                    style={{ top: s.top, height: s.height, left: `calc(${(s.lane / s.lanes) * 100}% + 2px)`, width: `calc(${100 / s.lanes}% - 4px)` }}
                    className={`absolute z-[1] overflow-hidden rounded border-l-4 px-1.5 py-0.5 text-left text-xs leading-4 shadow-sm ${TONES[s.event.tone]} ${s.event.muted ? "opacity-60" : ""} ${s.event.pending ? "animate-pulse opacity-60" : ""} ${onMove && s.event.draggable ? "cursor-grab" : ""}`}
                  >
                    <span className="block truncate font-medium">{s.event.title}</span>
                    <span className="block truncate">
                      {formatZonedTime(s.event.start, timeZone)}
                      {s.event.end ? ` – ${formatZonedTime(s.event.end, timeZone)}` : ""}
                    </span>
                    {s.height >= 48 && s.event.subtitle && <span className="block truncate opacity-80">{s.event.subtitle}</span>}
                    {s.height >= 64 && s.event.badge && <span className="block truncate opacity-80">{s.event.badge}</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
