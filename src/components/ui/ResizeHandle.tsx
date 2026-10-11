"use client";

import { useRef } from "react";

/**
 * A thin drag bar for resizing a neighbouring panel with the cursor.
 * "row" = horizontal bar, drag up/down; "col" = vertical bar, drag left/right.
 * Reports the pointer delta since the drag started; the caller owns the size.
 */
export function ResizeHandle({
  direction,
  onDragStart,
  onDrag,
  onDoubleClick,
  title,
}: {
  direction: "row" | "col";
  onDragStart: () => void;
  onDrag: (delta: number) => void;
  onDoubleClick?: () => void;
  title?: string;
}) {
  const startRef = useRef<number | null>(null);
  const isRow = direction === "row";

  return (
    <div
      role="separator"
      aria-orientation={isRow ? "horizontal" : "vertical"}
      title={title ?? "Drag to resize · double-click to collapse/restore"}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        startRef.current = isRow ? e.clientY : e.clientX;
        onDragStart();
      }}
      onPointerMove={(e) => {
        if (startRef.current === null) return;
        onDrag((isRow ? e.clientY : e.clientX) - startRef.current);
      }}
      onPointerUp={() => (startRef.current = null)}
      onPointerCancel={() => (startRef.current = null)}
      onDoubleClick={onDoubleClick}
      className={`group relative z-10 shrink-0 touch-none select-none bg-zinc-200 transition-colors hover:bg-violet-400 active:bg-violet-500 dark:bg-zinc-800 dark:hover:bg-violet-600 ${
        isRow ? "h-1.5 w-full cursor-row-resize" : "h-full w-1.5 cursor-col-resize"
      }`}
    >
      <span
        className={`pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-zinc-400 group-hover:bg-white ${
          isRow ? "h-0.5 w-8" : "h-8 w-0.5"
        }`}
      />
    </div>
  );
}
