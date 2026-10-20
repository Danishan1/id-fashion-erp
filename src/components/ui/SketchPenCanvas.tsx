"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

/**
 * Pen markup surface for a technical flat sketch: the designer draws directly
 * on the sketch the way they would red-line a printed flat. Unlike MaskCanvas
 * (which paints an *area* the AI may change), these strokes ARE the design
 * change — exported as one composited image (sketch + pen strokes) for the AI
 * to redraw as clean CAD line art.
 *
 * Generic and business-logic-free like MaskCanvas; the pen colours carry a
 * fixed meaning that the caller's prompt explains to the model.
 */
export type SketchPenTool = "ADD" | "REMOVE" | "ERASER";

export interface SketchPenCanvasHandle {
  /** Sketch + strokes composited at the sketch's natural size. Resolves null if nothing is drawn. */
  exportMarkup: () => Promise<Blob | null>;
  clear: () => void;
}

interface Point {
  x: number;
  y: number;
}

/** FREE = freehand path; LINE = [start, end]; CURVE = [start, bend point the curve passes through, end]. */
type StrokeShape = "FREE" | "LINE" | "CURVE";

interface Stroke {
  tool: SketchPenTool;
  /** Nib width relative to the sketch's longest side (keeps line weight consistent across image sizes). */
  width: number;
  shape?: StrokeShape;
  points: Point[];
}

const LINE_STYLES: { shape: StrokeShape; label: string; hint: string }[] = [
  { shape: "FREE", label: "〰", hint: "Freehand: draw freely, like a pencil" },
  { shape: "LINE", label: "╱", hint: "Straight line: drag from start to end for a straight seam, placket or hem line" },
  {
    shape: "CURVE",
    label: "⌒ Curve",
    hint: "Drag from start to end, then drag the purple dot to bend it (neckline, armhole, curved seam). Click elsewhere or press Enter to finish, Esc to cancel",
  },
];

/** Quadratic control point that makes the curve pass exactly through `through` at its midpoint. */
function curveControlPoint(from: Point, through: Point, to: Point): Point {
  return { x: 2 * through.x - (from.x + to.x) / 2, y: 2 * through.y - (from.y + to.y) / 2 };
}

const HANDLE_HIT_RADIUS_PX = 14; // on-screen pixels

export const PEN_COLORS: Record<Exclude<SketchPenTool, "ERASER">, string> = {
  ADD: "#e11d48", // red — add / change a line
  REMOVE: "#2563eb", // blue — remove what it covers
};

const NIBS = [
  { label: "Fine", rel: 0.003, dot: 4 },
  { label: "Medium", rel: 0.006, dot: 7 },
  { label: "Bold", rel: 0.011, dot: 10 },
];

const TOOLS: { tool: SketchPenTool; label: string; hint: string }[] = [
  { tool: "ADD", label: "Add", hint: "Red pen — Add / Change: draw new or reshaped lines (neckline, seam, dart, pocket, hem…)" },
  { tool: "REMOVE", label: "Remove", hint: "Blue pen — Remove: scribble over a line or detail to delete it" },
  { tool: "ERASER", label: "⌫ Erase", hint: "Eraser: erase your own pen marks (the sketch itself is never erased)" },
];

export const SketchPenCanvas = forwardRef<
  SketchPenCanvasHandle,
  {
    imageUrl: string;
    disabled?: boolean;
    onStrokesChange?: (hasStrokes: boolean) => void;
    /** 1 = fit the whole sketch in the box; >1 zooms in (the box scrolls). */
    zoom?: number;
  }
>(function SketchPenCanvas({ imageUrl, disabled, onStrokesChange, zoom = 1 }, ref) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<{ w: number; h: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeStrokeRef = useRef<Stroke | null>(null);
  const straightRef = useRef(false);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [tool, setTool] = useState<SketchPenTool>("ADD");
  const [nib, setNib] = useState(NIBS[1].rel);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [redoStack, setRedoStack] = useState<Stroke[]>([]);
  const [lineStyle, setLineStyle] = useState<StrokeShape>("FREE");
  /** A curve that is drawn but still adjustable (its handles are showing). */
  const [pendingCurve, setPendingCurve] = useState<Stroke | null>(null);
  /** What the current pointer drag is doing: drawing a new stroke, or moving one point of the pending curve. */
  const dragRef = useRef<{ kind: "draw" } | { kind: "handle"; index: number } | null>(null);
  const [hoverHandle, setHoverHandle] = useState(false);

  const recordNaturalSize = useCallback(() => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth) return;
    setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
  }, []);

  // Track the box size so the sketch always fills it (and refits when panels are resized).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setViewport({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const VIEWPORT_PADDING = 10;
  const displaySize =
    naturalSize && viewport
      ? (() => {
          const fit = Math.min(
            Math.max(50, viewport.w - VIEWPORT_PADDING * 2) / naturalSize.w,
            Math.max(50, viewport.h - VIEWPORT_PADDING * 2) / naturalSize.h
          );
          return { w: Math.round(naturalSize.w * fit * zoom), h: Math.round(naturalSize.h * fit * zoom) };
        })()
      : null;

  // A cached image may never fire onLoad — record its size straight away.
  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current.naturalWidth) recordNaturalSize();
  }, [imageUrl, recordNaturalSize]);

  const hasMarks = strokes.some((s) => s.tool !== "ERASER") || Boolean(pendingCurve);
  useEffect(() => {
    onStrokesChange?.(hasMarks);
  }, [hasMarks, onStrokesChange]);

  const drawStroke = useCallback(
    (ctx: CanvasRenderingContext2D, stroke: Stroke) => {
      if (!naturalSize || stroke.points.length === 0) return;
      const px = Math.max(1.5, stroke.width * Math.max(naturalSize.w, naturalSize.h));
      ctx.save();
      ctx.globalCompositeOperation = stroke.tool === "ERASER" ? "destination-out" : "source-over";
      ctx.strokeStyle = stroke.tool === "ERASER" ? "#000" : PEN_COLORS[stroke.tool];
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = stroke.tool === "ERASER" ? px * 3 : px;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const [first, ...rest] = stroke.points;
      if (stroke.shape === "CURVE" && stroke.points.length === 3) {
        const [from, through, to] = stroke.points;
        const ctrl = curveControlPoint(from, through, to);
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.quadraticCurveTo(ctrl.x, ctrl.y, to.x, to.y);
        ctx.stroke();
      } else if (rest.length === 0) {
        ctx.beginPath();
        ctx.arc(first.x, first.y, ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(first.x, first.y);
        // Quadratic smoothing through midpoints — hand-drawn curves read as clean curves.
        for (let i = 0; i < rest.length - 1; i++) {
          const mid = { x: (rest[i].x + rest[i + 1].x) / 2, y: (rest[i].y + rest[i + 1].y) / 2 };
          ctx.quadraticCurveTo(rest[i].x, rest[i].y, mid.x, mid.y);
        }
        const last = rest[rest.length - 1];
        ctx.lineTo(last.x, last.y);
        ctx.stroke();
      }
      ctx.restore();
    },
    [naturalSize]
  );

  const redraw = useCallback(
    (list: Stroke[], inProgress?: Stroke | null) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const s of list) drawStroke(ctx, s);
      if (inProgress) drawStroke(ctx, inProgress);
    },
    [drawStroke]
  );

  // Size the canvas 1:1 with the sketch once both exist; repaint existing strokes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!naturalSize || !canvas) return;
    canvas.width = naturalSize.w;
    canvas.height = naturalSize.h;
    redraw(strokes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [naturalSize]);

  function pointFromEvent(e: React.PointerEvent<HTMLCanvasElement>): Point {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  /** Natural-pixel distance that equals HANDLE_HIT_RADIUS_PX on screen at the current size/zoom. */
  function hitRadius(): number {
    const canvas = canvasRef.current;
    if (!canvas) return HANDLE_HIT_RADIUS_PX;
    return HANDLE_HIT_RADIUS_PX * (canvas.width / canvas.getBoundingClientRect().width);
  }

  /** Index of the pending curve's handle under `p` (bend point first, so it wins when they overlap), or -1. */
  function handleAt(p: Point): number {
    if (!pendingCurve) return -1;
    const r = hitRadius();
    for (const i of [1, 0, 2]) {
      const h = pendingCurve.points[i];
      if (Math.hypot(h.x - p.x, h.y - p.y) <= r) return i;
    }
    return -1;
  }

  /** Locks the pending curve into the drawing (it can still be undone). */
  function commitPendingCurve(base: Stroke[] = strokes): Stroke[] {
    if (!pendingCurve) return base;
    const next = [...base, pendingCurve];
    setStrokes(next);
    setRedoStack([]);
    setPendingCurve(null);
    redraw(next);
    return next;
  }

  function cancelPendingCurve() {
    if (!pendingCurve) return;
    setPendingCurve(null);
    redraw(strokes);
  }

  function chooseTool(next: SketchPenTool) {
    commitPendingCurve();
    setTool(next);
  }

  function chooseLineStyle(next: StrokeShape) {
    commitPendingCurve();
    setLineStyle(next);
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pointFromEvent(e);

    // Grabbing a handle of the curve being adjusted → move that point.
    const handle = handleAt(p);
    if (handle >= 0) {
      dragRef.current = { kind: "handle", index: handle };
      return;
    }

    // Clicking anywhere else finishes the pending curve, then starts a new stroke.
    const base = commitPendingCurve();
    const shape: StrokeShape = tool === "ERASER" ? "FREE" : e.shiftKey && lineStyle === "FREE" ? "LINE" : lineStyle;
    straightRef.current = shape === "LINE";
    activeStrokeRef.current = { tool, width: nib, shape, points: shape === "CURVE" ? [p, p, p] : [p] };
    dragRef.current = { kind: "draw" };
    redraw(base, activeStrokeRef.current);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    const p = pointFromEvent(e);
    if (!dragRef.current) {
      const overHandle = handleAt(p) >= 0;
      if (overHandle !== hoverHandle) setHoverHandle(overHandle);
      return;
    }

    if (dragRef.current.kind === "handle" && pendingCurve) {
      const index = dragRef.current.index;
      const points = pendingCurve.points.map((pt, i) => (i === index ? p : pt));
      const updated = { ...pendingCurve, points };
      setPendingCurve(updated);
      redraw(strokes, updated);
      return;
    }

    const active = activeStrokeRef.current;
    if (!active) return;
    if (active.shape === "CURVE") {
      // While dragging, the curve is a straight segment; its bend point stays at the middle until adjusted.
      const from = active.points[0];
      active.points = [from, { x: (from.x + p.x) / 2, y: (from.y + p.y) / 2 }, p];
    } else if (straightRef.current || e.shiftKey) {
      // Straight style or Shift = ruler: a perfectly straight seam / placket / hem line.
      active.shape = "LINE";
      active.points = [active.points[0], p];
    } else {
      active.points.push(p);
    }
    redraw(strokes, active);
  }

  function handlePointerUp() {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.kind === "handle") return;

    const active = activeStrokeRef.current;
    activeStrokeRef.current = null;
    if (!active) return;

    if (active.shape === "CURVE") {
      const [from, , to] = active.points;
      if (Math.hypot(to.x - from.x, to.y - from.y) < hitRadius()) {
        redraw(strokes); // too short to be a curve — treat as a stray click
        return;
      }
      setPendingCurve(active); // keep it adjustable: drag the purple dot to bend it
      redraw(strokes, active);
      return;
    }

    const next = [...strokes, active];
    setStrokes(next);
    setRedoStack([]);
    redraw(next);
  }

  function undo() {
    if (pendingCurve) {
      cancelPendingCurve();
      return;
    }
    if (strokes.length === 0) return;
    const next = strokes.slice(0, -1);
    setRedoStack((r) => [...r, strokes[strokes.length - 1]]);
    setStrokes(next);
    redraw(next);
  }

  function redo() {
    if (redoStack.length === 0) return;
    const stroke = redoStack[redoStack.length - 1];
    const next = [...strokes, stroke];
    setRedoStack((r) => r.slice(0, -1));
    setStrokes(next);
    redraw(next);
  }

  function clear() {
    setStrokes([]);
    setRedoStack([]);
    setPendingCurve(null);
    redraw([]);
  }

  // Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z / Ctrl+Y while the pen canvas is on screen;
  // Enter finishes / Esc cancels a curve that is still being adjusted.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (pendingCurve && e.key === "Enter") {
        e.preventDefault();
        commitPendingCurve();
        return;
      }
      if (pendingCurve && e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation(); // don't also exit the editor's full-screen mode
        cancelPendingCurve();
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        redo();
      }
    }
    // Capture phase, so Esc on a pending curve is handled before the editor's own Esc (exit full screen).
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  useImperativeHandle(ref, () => ({
    clear,
    exportMarkup: () =>
      new Promise((resolve) => {
        const img = imgRef.current;
        const strokesCanvas = canvasRef.current;
        if (!img || !strokesCanvas || !naturalSize || !hasMarks) {
          resolve(null);
          return;
        }
        const out = document.createElement("canvas");
        out.width = naturalSize.w;
        out.height = naturalSize.h;
        const ctx = out.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, out.width, out.height);
        ctx.drawImage(img, 0, 0, out.width, out.height);
        ctx.drawImage(strokesCanvas, 0, 0);
        out.toBlob((blob) => resolve(blob), "image/png");
      }),
  }));

  const activeHint =
    tool !== "ERASER" && lineStyle !== "FREE"
      ? LINE_STYLES.find((s) => s.shape === lineStyle)?.hint
      : TOOLS.find((t) => t.tool === tool)?.hint;
  const nothingToUndo = strokes.length === 0 && !pendingCurve;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto whitespace-nowrap border-b border-zinc-200 bg-white px-2 py-1 dark:border-zinc-800 dark:bg-zinc-900">
        {TOOLS.map((t) => (
          <button
            key={t.tool}
            type="button"
            title={t.hint}
            disabled={disabled}
            onClick={() => chooseTool(t.tool)}
            className={`flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-xs font-medium disabled:opacity-50 ${
              tool === t.tool
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                : "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200"
            }`}
          >
            {t.tool !== "ERASER" && (
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: PEN_COLORS[t.tool] }} />
            )}
            {t.label}
          </button>
        ))}
        <span className="mx-1 h-4 w-px shrink-0 bg-zinc-200 dark:bg-zinc-700" />
        {LINE_STYLES.map((s) => (
          <button
            key={s.shape}
            type="button"
            title={s.hint}
            disabled={disabled || tool === "ERASER"}
            onClick={() => chooseLineStyle(s.shape)}
            className={`shrink-0 rounded border px-1.5 py-0.5 text-xs disabled:opacity-40 ${
              lineStyle === s.shape && tool !== "ERASER"
                ? "border-violet-600 bg-violet-600 text-white"
                : "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200"
            }`}
          >
            {s.label}
          </button>
        ))}
        <span className="mx-1 h-4 w-px shrink-0 bg-zinc-200 dark:bg-zinc-700" />
        {NIBS.map((n) => (
          <button
            key={n.label}
            type="button"
            title={`${n.label} nib`}
            aria-label={`${n.label} nib`}
            disabled={disabled}
            onClick={() => setNib(n.rel)}
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border disabled:opacity-50 ${
              nib === n.rel
                ? "border-indigo-600 bg-indigo-50 dark:bg-indigo-950/50"
                : "border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700"
            }`}
          >
            <span className="rounded-full bg-zinc-800 dark:bg-zinc-200" style={{ width: n.dot, height: n.dot }} />
          </button>
        ))}
        <div className="ml-auto flex shrink-0 gap-1 pl-1">
          <button
            type="button"
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
            disabled={disabled || nothingToUndo}
            onClick={undo}
            className="rounded border border-zinc-300 px-1.5 py-0.5 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200"
          >
            ↶
          </button>
          <button
            type="button"
            title="Redo (Ctrl+Shift+Z)"
            aria-label="Redo"
            disabled={disabled || redoStack.length === 0}
            onClick={redo}
            className="rounded border border-zinc-300 px-1.5 py-0.5 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200"
          >
            ↷
          </button>
          <button
            type="button"
            title="Clear all pen marks"
            disabled={disabled || nothingToUndo}
            onClick={clear}
            className="rounded border border-zinc-300 px-1.5 py-0.5 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200"
          >
            Clear
          </button>
          <span
            className="cursor-help px-1 text-xs text-zinc-400"
            title={`${activeHint}. Hold Shift for a straight line. Ctrl + scroll to zoom.`}
          >
            ⓘ
          </span>
        </div>
      </div>
      {/* Floats over the sketch (not in the layout) so the sketch never shifts while a curve is being bent. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
      {pendingCurve && (
        <div className="pointer-events-auto absolute inset-x-2 bottom-2 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-violet-200 bg-violet-50/95 px-3 py-1 text-xs text-violet-800 shadow-md backdrop-blur dark:border-violet-900 dark:bg-violet-950/90 dark:text-violet-200">
          <span>⌒ Drag the purple dot to bend the curve · drag the white dots to move its ends</span>
          <button
            type="button"
            onClick={() => commitPendingCurve()}
            className="ml-auto rounded bg-violet-600 px-2 py-0.5 text-xs font-semibold text-white hover:bg-violet-700"
          >
            ✓ Done (Enter)
          </button>
          <button
            type="button"
            onClick={cancelPendingCurve}
            className="rounded border border-violet-300 px-2 py-0.5 text-xs hover:bg-violet-100 dark:border-violet-700 dark:hover:bg-violet-900/40"
          >
            ✕ Cancel (Esc)
          </button>
        </div>
      )}

      {/* flex + margin:auto on the child centres it while still letting a zoomed sketch scroll */}
      <div ref={viewportRef} className="relative flex min-h-0 flex-1 overflow-auto bg-zinc-100 dark:bg-zinc-950">
        <div
          className="relative m-auto shrink-0 bg-white shadow-sm"
          style={displaySize ? { width: displaySize.w, height: displaySize.h } : undefined}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            src={imageUrl}
            alt="Technical flat sketch — draw your changes with the pen"
            draggable={false}
            onLoad={recordNaturalSize}
            className={`block select-none ${displaySize ? "h-full w-full" : "max-h-full max-w-full"}`}
          />
          {naturalSize && (
            <canvas
              ref={canvasRef}
              className="absolute inset-0 h-full w-full touch-none"
              style={{
                cursor: disabled ? "default" : hoverHandle ? "grab" : tool === "ERASER" ? "cell" : "crosshair",
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            />
          )}
          {/* Curve handles — screen-only overlay, never part of the exported markup. */}
          {pendingCurve && naturalSize &&
            pendingCurve.points.map((pt, i) => (
              <span
                key={i}
                className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow ${
                  i === 1 ? "h-4 w-4 border-white bg-violet-600" : "h-3 w-3 border-violet-600 bg-white"
                }`}
                style={{ left: `${(pt.x / naturalSize.w) * 100}%`, top: `${(pt.y / naturalSize.h) * 100}%` }}
              />
            ))}
        </div>
      </div>
      </div>
    </div>
  );
});
