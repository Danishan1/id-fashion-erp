"use client";

import { useEffect, useState, type ReactNode } from "react";

interface FilePreviewModalProps {
  open: boolean;
  onClose: () => void;
  /** Renders inline in the browser (server should respond with Content-Disposition: inline). */
  previewUrl: string;
  /** Forces a save-as download (server should respond with Content-Disposition: attachment). */
  downloadUrl: string;
  fileName: string;
  mimeType: string;
}

const ZOOM_STEP = 0.25;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;

/**
 * Shared image/document preview — click a file anywhere in the app and open
 * it here instead of forcing a download. Images get zoom + 90°-rotate
 * controls; PDFs render in the browser's own viewer (which already has zoom);
 * anything else (Word/Excel) has no inline preview, just a download button.
 */
export function FilePreviewModal({ open, onClose, previewUrl, downloadUrl, fileName, mimeType }: FilePreviewModalProps) {
  // Zoom/rotation intentionally start fresh via useState's initializer, not a
  // reset effect — the caller is expected to pass a `key` (e.g. the file's id)
  // so switching files remounts this component instead of reusing state.
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const isImage = mimeType.startsWith("image/");
  const isPdf = mimeType === "application/pdf";

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/90"
      role="dialog"
      aria-modal="true"
      aria-label={fileName}
      onClick={onClose}
    >
      <div
        className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-3"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="truncate text-sm font-medium text-white">{fileName}</p>

        <div className="flex items-center gap-1.5">
          {isImage && (
            <>
              <ToolbarButton label="Zoom out" onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))}>
                −
              </ToolbarButton>
              <span className="w-12 text-center text-xs text-zinc-300">{Math.round(zoom * 100)}%</span>
              <ToolbarButton label="Zoom in" onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))}>
                +
              </ToolbarButton>
              <ToolbarButton label="Rotate left" onClick={() => setRotation((r) => r - 90)}>
                ⟲
              </ToolbarButton>
              <ToolbarButton label="Rotate right" onClick={() => setRotation((r) => r + 90)}>
                ⟳
              </ToolbarButton>
              <ToolbarButton
                label="Reset"
                onClick={() => {
                  setZoom(1);
                  setRotation(0);
                }}
              >
                Reset
              </ToolbarButton>
            </>
          )}
          <a
            href={downloadUrl}
            className="rounded-md border border-white/20 px-2.5 py-1 text-xs font-medium text-white hover:bg-white/10"
          >
            Download
          </a>
          <ToolbarButton label="Close" onClick={onClose}>
            ✕
          </ToolbarButton>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center overflow-auto p-6" onClick={(e) => e.stopPropagation()}>
        {isImage && (
          // eslint-disable-next-line @next/next/no-img-element -- arbitrary uploaded file, unknown dimensions, zoomed/rotated
          <img
            src={previewUrl}
            alt={fileName}
            style={{ transform: `scale(${zoom}) rotate(${rotation}deg)` }}
            className="max-h-full max-w-full object-contain transition-transform duration-150"
          />
        )}

        {isPdf && <iframe src={previewUrl} title={fileName} className="h-full w-full rounded-md bg-white" />}

        {!isImage && !isPdf && (
          <div className="text-center text-zinc-200">
            <p className="mb-3 text-sm">Preview isn&apos;t available for this file type.</p>
            <a
              href={downloadUrl}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
            >
              Download {fileName}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function ToolbarButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="rounded-md border border-white/20 px-2.5 py-1 text-xs font-medium text-white hover:bg-white/10"
    >
      {children}
    </button>
  );
}
