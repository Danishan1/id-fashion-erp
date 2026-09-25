"use client";

import { useEffect, useRef, useState } from "react";
import { FilePreviewModal } from "@/components/ui/FilePreviewModal";

interface ImageAttachment {
  id: string;
  fileName: string;
  mimeType: string;
}

interface SampleImagesSectionProps {
  sampleRequestId: string;
  /**
   * Whether this viewer holds `sampling.edit` (2026-09-24) — gates
   * Upload/Set as Main/Remove. Display-convenience only, matching every
   * other gate in this module — real enforcement is entirely server-side
   * in the underlying attachment/main-image routes.
   */
  canEdit: boolean;
}

function inlineUrl(id: string) {
  return `/api/v1/sampling/attachments/${id}/download?disposition=inline`;
}

function attachmentDownloadUrl(id: string) {
  return `/api/v1/sampling/attachments/${id}/download`;
}

/**
 * A dedicated image gallery — one designated "main" image plus any number of
 * additional images — for a future product-gallery/e-commerce-style display.
 * Reuses the same shared Attachment bag the existing Attachments section
 * already uses (relatedModule SAMPLE_REQUEST), filtered client-side to
 * image/* mime types so this stays a pure display concern layered on top of
 * that shared list, not a second parallel storage mechanism.
 */
export function SampleImagesSection({ sampleRequestId, canEdit }: SampleImagesSectionProps) {
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [mainImageAttachmentId, setMainImageAttachmentId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [uploadInputKey, setUploadInputKey] = useState(0);
  const [previewTarget, setPreviewTarget] = useState<ImageAttachment | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    setIsLoading(true);
    const [attachmentsRes, requestRes] = await Promise.all([
      fetch(`/api/v1/sampling/${sampleRequestId}/attachments`),
      fetch(`/api/v1/sampling/${sampleRequestId}`),
    ]);
    const attachmentsBody = await attachmentsRes.json();
    const requestBody = await requestRes.json();
    setIsLoading(false);
    if (attachmentsRes.ok) {
      setImages((attachmentsBody.data ?? []).filter((a: ImageAttachment) => a.mimeType.startsWith("image/")));
    }
    if (requestRes.ok) {
      setMainImageAttachmentId(requestBody.data?.mainImageAttachmentId ?? null);
    }
  }

  useEffect(() => {
    Promise.all([
      fetch(`/api/v1/sampling/${sampleRequestId}/attachments`).then(async (res) => ({ res, body: await res.json() })),
      fetch(`/api/v1/sampling/${sampleRequestId}`).then(async (res) => ({ res, body: await res.json() })),
    ]).then(([attachments, request]) => {
      setIsLoading(false);
      if (attachments.res.ok) {
        setImages((attachments.body.data ?? []).filter((a: ImageAttachment) => a.mimeType.startsWith("image/")));
      }
      if (request.res.ok) {
        setMainImageAttachmentId(request.body.data?.mainImageAttachmentId ?? null);
      }
    });
  }, [sampleRequestId]);

  async function handleUpload(file: File) {
    if (!file.type.startsWith("image/")) {
      setError("Only image files (JPEG, PNG, WEBP) can be added here.");
      return;
    }
    setIsBusy(true);
    setError(null);
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`/api/v1/sampling/${sampleRequestId}/attachments`, { method: "POST", body: formData });
    setIsBusy(false);
    setUploadInputKey((k) => k + 1);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to upload image.");
      return;
    }
    await load();
  }

  async function setMainImage(attachmentId: string | null) {
    setIsBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/sampling/${sampleRequestId}/main-image`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attachmentId }),
    });
    setIsBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to set main image.");
      return;
    }
    setMainImageAttachmentId(attachmentId);
  }

  async function removeImage(attachmentId: string) {
    setIsBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/sampling/attachments/${attachmentId}`, { method: "DELETE" });
    setIsBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to remove image.");
      return;
    }
    await load();
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Images</h2>
        {canEdit && (
          <label className="cursor-pointer rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
            Upload Image
            <input
              key={uploadInputKey}
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              disabled={isBusy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleUpload(file);
              }}
            />
          </label>
        )}
      </div>

      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-3">
        {isLoading ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : images.length === 0 ? (
          <p className="text-sm text-zinc-500">No images uploaded yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {images.map((img) => {
              const isMain = img.id === mainImageAttachmentId;
              return (
                <div
                  key={img.id}
                  className={`overflow-hidden rounded-md border ${
                    isMain ? "border-indigo-500 ring-2 ring-indigo-500" : "border-zinc-200 dark:border-zinc-800"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={inlineUrl(img.id)}
                    alt={img.fileName}
                    onClick={() => setPreviewTarget(img)}
                    className="h-28 w-full cursor-zoom-in object-cover"
                  />
                  <div className="space-y-1 p-1.5">
                    {isMain ? (
                      <span className="block rounded bg-indigo-100 px-1.5 py-0.5 text-center text-[10px] font-semibold text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">
                        Main Image
                      </span>
                    ) : (
                      canEdit && (
                        <button
                          type="button"
                          onClick={() => setMainImage(img.id)}
                          disabled={isBusy}
                          className="block w-full rounded border border-zinc-300 px-1.5 py-0.5 text-[10px] font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                        >
                          Set as Main
                        </button>
                      )
                    )}
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => removeImage(img.id)}
                        disabled={isBusy}
                        className="block w-full text-center text-[10px] font-medium text-red-600 hover:text-red-500 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {previewTarget && (
        <FilePreviewModal
          key={previewTarget.id}
          open
          onClose={() => setPreviewTarget(null)}
          previewUrl={inlineUrl(previewTarget.id)}
          downloadUrl={attachmentDownloadUrl(previewTarget.id)}
          fileName={previewTarget.fileName}
          mimeType={previewTarget.mimeType}
        />
      )}
    </div>
  );
}
