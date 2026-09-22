"use client";

import { useRef, useState } from "react";

function imageUrl(attachmentId: string) {
  return `/api/v1/ai-designer/attachments/${attachmentId}/download?disposition=inline`;
}

async function parseJson(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message ?? "Request failed.");
  return body;
}

const DEFAULT_X = 70;
const DEFAULT_Y = 80;
const DEFAULT_WIDTH = 20;
const MIN_WIDTH = 5;
const MAX_WIDTH = 60;

interface Props {
  projectId: string;
  designImageAttachmentId: string;
  logoAttachmentId: string | null;
  logoXPercent: number | null;
  logoYPercent: number | null;
  logoWidthPercent: number | null;
  brandedImageAttachmentId: string | null;
  busy: string | null;
  run: (key: string, fn: () => Promise<unknown>) => Promise<void>;
}

/**
 * Interactive drag/resize control over the logo's position on the current
 * design image. The container's own CSS aspect-ratio is set from the
 * design image's real naturalWidth/naturalHeight (read on <img> onLoad),
 * so object-fit:contain renders with zero letterboxing — a plain
 * percent-of-container calculation is already percent-of-image, with none
 * of the Tech Pack PDF's letterbox-correction math needed (that problem
 * only exists because a PDF's fixed callout box has a DIFFERENT aspect
 * ratio than its source photo; here the container is deliberately sized to
 * always match).
 */
export function LogoPositioner({
  projectId,
  designImageAttachmentId,
  logoAttachmentId,
  logoXPercent,
  logoYPercent,
  logoWidthPercent,
  brandedImageAttachmentId,
  busy,
  run,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [x, setX] = useState(logoXPercent ?? DEFAULT_X);
  const [y, setY] = useState(logoYPercent ?? DEFAULT_Y);
  const [width, setWidth] = useState(logoWidthPercent ?? DEFAULT_WIDTH);
  const [dragging, setDragging] = useState<"move" | "resize" | null>(null);

  const savePosition = (nextX: number, nextY: number, nextWidth: number) =>
    run("logo-position", () =>
      fetch(`/api/v1/ai-designer/projects/${projectId}/branding/logo-position`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logoXPercent: nextX, logoYPercent: nextY, logoWidthPercent: nextWidth }),
      }).then(parseJson)
    );

  const uploadLogo = (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return run("upload-logo", () =>
      fetch(`/api/v1/ai-designer/projects/${projectId}/branding/logo`, { method: "POST", body: formData }).then(parseJson)
    );
  };

  const removeLogo = () =>
    run("delete-logo", () => fetch(`/api/v1/ai-designer/projects/${projectId}/branding/logo`, { method: "DELETE" }).then(parseJson));

  const applyBranding = () =>
    run("apply-branding", () =>
      fetch(`/api/v1/ai-designer/projects/${projectId}/branding/apply`, { method: "POST" }).then(parseJson)
    );

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (dragging === "move") {
      const nextX = Math.min(100 - width, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100 - width / 2));
      const nextY = Math.min(100 - width, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100 - width / 2));
      setX(nextX);
      setY(nextY);
    } else {
      const deltaPercent = ((e.clientX - rect.left) / rect.width) * 100 - x;
      const nextWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, deltaPercent));
      setWidth(nextWidth);
      setX(Math.min(x, 100 - nextWidth));
      setY(Math.min(y, 100 - nextWidth));
    }
  };

  const onPointerUp = () => {
    if (dragging) savePosition(x, y, width);
    setDragging(null);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">
        Upload a logo, then drag it into position and drag its bottom-right handle to resize — the actual
        composited image is generated server-side once you click Apply Branding.
      </p>

      {!logoAttachmentId ? (
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy === "upload-logo"}
          className="block w-full text-sm"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) uploadLogo(file);
            e.target.value = "";
          }}
        />
      ) : (
        <>
          <div
            ref={containerRef}
            className="relative w-full max-w-md select-none overflow-hidden rounded border bg-white"
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl(designImageAttachmentId)}
              alt="Current design"
              className="block w-full"
              draggable={false}
              onLoad={(e) => {
                const el = e.currentTarget;
                if (el.naturalWidth && el.naturalHeight && containerRef.current) {
                  containerRef.current.style.aspectRatio = `${el.naturalWidth} / ${el.naturalHeight}`;
                }
              }}
            />
            <div
              className="absolute cursor-move border-2 border-indigo-500"
              style={{ left: `${x}%`, top: `${y}%`, width: `${width}%`, aspectRatio: "1 / 1" }}
              onPointerDown={() => setDragging("move")}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl(logoAttachmentId)} alt="Logo" className="pointer-events-none h-full w-full object-contain" />
              <div
                className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-full border border-white bg-indigo-600"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setDragging("resize");
                }}
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="block">
              <span className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400 cursor-pointer">Replace logo</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={busy === "upload-logo"}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadLogo(file);
                  e.target.value = "";
                }}
              />
            </label>
            <button type="button" disabled={busy === "delete-logo"} onClick={removeLogo} className="text-xs text-red-600 hover:underline disabled:opacity-50">
              {busy === "delete-logo" ? "Removing…" : "Remove logo"}
            </button>
            <button
              type="button"
              disabled={busy === "apply-branding"}
              onClick={applyBranding}
              className="ml-auto rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {busy === "apply-branding" ? "Applying…" : "Apply Branding"}
            </button>
          </div>
        </>
      )}

      {brandedImageAttachmentId && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-zinc-500">Branded Result</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl(brandedImageAttachmentId)} alt="Branded design" className="h-40 w-40 rounded border object-contain bg-white" />
          <a
            href={imageUrl(brandedImageAttachmentId)}
            download
            className="block text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            Download branded image
          </a>
        </div>
      )}
    </div>
  );
}
