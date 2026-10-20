"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

/**
 * "Draw & Describe" — a generic, business-logic-free drawing surface: shows
 * an image, lets the user pencil-highlight an area over it, and can export
 * that area as a real inpainting mask PNG (OpenAI's own contract: fully
 * TRANSPARENT pixels mark the editable area, fully OPAQUE pixels are
 * preserved — the inverse of what the user visually draws, handled entirely
 * inside exportMask() below so no caller has to know that detail).
 *
 * Deliberately as generic as ConfirmModal/FilePreviewModal (this same
 * folder) — it has zero knowledge of AiDesignerProject vs.
 * ReplicateDesignProject, which is what lets both of this app's otherwise
 * deliberately-isolated Edit Design workspaces (see EditDesignWorkspace.tsx
 * and EditReplicateDesignWorkspace.tsx) share this one drawing widget
 * without violating that isolation — the same way they already share
 * ConfirmModal/FilePreviewModal.
 */
export interface MaskCanvasHandle {
  /** Resolves null if nothing has been drawn yet. */
  exportMask: () => Promise<Blob | null>;
  clear: () => void;
}

const BRUSH_SIZES = [
  { label: "S", px: 16 },
  { label: "M", px: 32 },
  { label: "L", px: 56 },
  { label: "XL", px: 90 },
];

export const MaskCanvas = forwardRef<MaskCanvasHandle, { imageUrl: string; disabled?: boolean; onStrokesChange?: (hasStrokes: boolean) => void }>(
  function MaskCanvas({ imageUrl, disabled, onStrokesChange }, ref) {
    const imgRef = useRef<HTMLImageElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawingRef = useRef(false);
    const lastPointRef = useRef<{ x: number; y: number } | null>(null);
    const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
    const [brushSize, setBrushSize] = useState(32);
    const [hasStrokes, setHasStrokes] = useState(false);

    // The <canvas> only mounts once naturalSize is known (its width/height
    // attributes must be set at creation to match the image 1:1 pixel-for-
    // pixel) — so this can only ever record the image's own natural
    // dimensions, never touch canvasRef directly (a real bug caught live:
    // reading canvasRef.current here, before the canvas has ever mounted,
    // always returned null and silently no-op'd, permanently deadlocking —
    // naturalSize never got set because this bailed out before reaching the
    // setNaturalSize call). A second effect below does the actual sizing
    // once the canvas element genuinely exists in the DOM.
    const recordNaturalSize = useCallback(() => {
      const img = imgRef.current;
      if (!img || !img.naturalWidth) return;
      setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
    }, []);

    // A cached/already-loaded <img> never re-fires onLoad in every browser —
    // record its size immediately if it's already complete on mount/imageUrl change.
    useEffect(() => {
      if (imgRef.current?.complete && imgRef.current.naturalWidth) recordNaturalSize();
    }, [imageUrl, recordNaturalSize]);

    // Sizes the canvas's own width/height attributes (never CSS) to match
    // the image exactly, once naturalSize is known AND the canvas has
    // actually mounted in response to it.
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!naturalSize || !canvas) return;
      canvas.width = naturalSize.w;
      canvas.height = naturalSize.h;
      canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
      setHasStrokes(false);
      onStrokesChange?.(false);
    }, [naturalSize, onStrokesChange]);

    function pointFromEvent(e: React.PointerEvent<HTMLCanvasElement>) {
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
    }

    function paintStroke(from: { x: number; y: number } | null, to: { x: number; y: number }) {
      const ctx = canvasRef.current?.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "rgba(220, 38, 38, 0.55)";
      ctx.strokeStyle = "rgba(220, 38, 38, 0.55)";
      ctx.lineWidth = brushSize;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (from) {
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(to.x, to.y, brushSize / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      if (!hasStrokes) {
        setHasStrokes(true);
        onStrokesChange?.(true);
      }
    }

    function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
      if (disabled) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      drawingRef.current = true;
      const p = pointFromEvent(e);
      lastPointRef.current = p;
      paintStroke(null, p);
    }

    function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
      if (!drawingRef.current || disabled) return;
      const p = pointFromEvent(e);
      paintStroke(lastPointRef.current, p);
      lastPointRef.current = p;
    }

    function handlePointerUp() {
      drawingRef.current = false;
      lastPointRef.current = null;
    }

    function clear() {
      const canvas = canvasRef.current;
      canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
      setHasStrokes(false);
      onStrokesChange?.(false);
    }

    useImperativeHandle(ref, () => ({
      clear,
      exportMask: () =>
        new Promise((resolve) => {
          const canvas = canvasRef.current;
          if (!canvas || !hasStrokes) {
            resolve(null);
            return;
          }
          const strokesCtx = canvas.getContext("2d");
          if (!strokesCtx) {
            resolve(null);
            return;
          }
          const strokes = strokesCtx.getImageData(0, 0, canvas.width, canvas.height);

          const maskCanvas = document.createElement("canvas");
          maskCanvas.width = canvas.width;
          maskCanvas.height = canvas.height;
          const maskCtx = maskCanvas.getContext("2d");
          if (!maskCtx) {
            resolve(null);
            return;
          }
          const mask = maskCtx.createImageData(canvas.width, canvas.height);
          // OpenAI's own contract: a mask's fully-transparent pixels mark
          // the editable area, everything else is preserved as-is — the
          // exact inverse of what's drawn on screen (a visible red
          // highlight), so every drawn pixel becomes transparent here and
          // every untouched pixel becomes opaque white.
          for (let i = 0; i < strokes.data.length; i += 4) {
            const drawn = strokes.data[i + 3] > 0;
            mask.data[i] = 255;
            mask.data[i + 1] = 255;
            mask.data[i + 2] = 255;
            mask.data[i + 3] = drawn ? 0 : 255;
          }
          maskCtx.putImageData(mask, 0, 0);
          maskCanvas.toBlob((blob) => resolve(blob), "image/png");
        }),
    }));

    return (
      <div className="flex h-full flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-white px-3 py-1.5 dark:border-zinc-800 dark:bg-zinc-900">
          <span className="text-xs font-medium text-zinc-500">Brush</span>
          {BRUSH_SIZES.map((b) => (
            <button
              key={b.label}
              type="button"
              disabled={disabled}
              onClick={() => setBrushSize(b.px)}
              className={`rounded border px-2 py-0.5 text-xs disabled:opacity-50 ${
                brushSize === b.px
                  ? "border-indigo-600 bg-indigo-600 text-white"
                  : "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200"
              }`}
            >
              {b.label}
            </button>
          ))}
          <button
            type="button"
            disabled={disabled || !hasStrokes}
            onClick={clear}
            className="ml-auto rounded border border-zinc-300 px-2 py-0.5 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200"
          >
            Clear Drawing
          </button>
        </div>

        <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-zinc-100 dark:bg-zinc-950">
          <div className="relative max-h-full max-w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imgRef}
              src={imageUrl}
              alt="Draw on the area you want to change"
              draggable={false}
              onLoad={recordNaturalSize}
              className="block max-h-[60vh] max-w-full select-none object-contain"
            />
            {naturalSize && (
              <canvas
                ref={canvasRef}
                className="absolute inset-0 h-full w-full touch-none"
                style={{ cursor: disabled ? "default" : "crosshair" }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
              />
            )}
          </div>
        </div>
      </div>
    );
  }
);
