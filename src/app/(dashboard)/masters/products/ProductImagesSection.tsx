"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";

interface ImageAttachment {
  id: string;
  fileName: string;
  mimeType: string;
}

interface ProductImagesSectionProps {
  productId: string;
  onClose: () => void;
}

function downloadUrl(id: string) {
  return `/api/v1/products/attachments/${id}/download?disposition=inline`;
}

/**
 * The Images modal's content, mounted only while it's the currently-open row
 * action — same "render only while open, let mount BE the reset" shape as
 * VariantsSection, triggered from the Styles list's single per-row
 * ActionMenu (ProductsListClient.tsx) rather than its own trigger button.
 */
export function ProductImagesSection({ productId, onClose }: ProductImagesSectionProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [mainImageAttachmentId, setMainImageAttachmentIdState] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [uploadInputKey, setUploadInputKey] = useState(0);

  async function load() {
    setIsLoading(true);
    const [attachmentsRes, productRes] = await Promise.all([
      fetch(`/api/v1/products/${productId}/attachments`),
      fetch(`/api/v1/products/${productId}`),
    ]);
    const attachmentsBody = await attachmentsRes.json();
    const productBody = await productRes.json();
    setIsLoading(false);
    if (attachmentsRes.ok) {
      setImages(attachmentsBody.data ?? []);
    } else {
      setError(attachmentsBody?.error?.message ?? "Failed to load images.");
    }
    if (productRes.ok) {
      setMainImageAttachmentIdState(productBody.data?.mainImageAttachmentId ?? null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/api/v1/products/${productId}/attachments`).then((r) => r.json()),
      fetch(`/api/v1/products/${productId}`).then((r) => r.json()),
    ]).then(([attachmentsBody, productBody]) => {
      if (cancelled) return;
      if (attachmentsBody?.data) {
        setImages(attachmentsBody.data);
      } else {
        setError(attachmentsBody?.error?.message ?? "Failed to load images.");
      }
      setMainImageAttachmentIdState(productBody?.data?.mainImageAttachmentId ?? null);
      setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [productId]);

  async function handleUpload(file: File) {
    if (!file.type.startsWith("image/")) {
      setError("Only image files (JPEG, PNG, WEBP) can be added to a style's gallery.");
      return;
    }
    setIsBusy(true);
    setError(null);
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`/api/v1/products/${productId}/attachments`, { method: "POST", body: formData });
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
    const res = await fetch(`/api/v1/products/${productId}/main-image`, {
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
    setMainImageAttachmentIdState(attachmentId);
  }

  async function removeImage(attachmentId: string) {
    setIsBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/products/attachments/${attachmentId}`, { method: "DELETE" });
    setIsBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to remove image.");
      return;
    }
    await load();
  }

  return (
    <Modal open onClose={onClose} title="Style Images (Main + Gallery)" maxWidthClass="max-w-xl">
      <div className="space-y-4">
        <label className="inline-block cursor-pointer rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
          Upload Image
          <input
            key={uploadInputKey}
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

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        {isLoading ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : images.length === 0 ? (
          <p className="text-sm text-zinc-500">No images uploaded yet.</p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
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
                  <img src={downloadUrl(img.id)} alt={img.fileName} className="h-24 w-full object-cover" />
                  <div className="space-y-1 p-1.5">
                    {isMain ? (
                      <span className="block rounded bg-indigo-100 px-1.5 py-0.5 text-center text-[10px] font-semibold text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">
                        Main Image
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setMainImage(img.id)}
                        disabled={isBusy}
                        className="block w-full rounded border border-zinc-300 px-1.5 py-0.5 text-[10px] font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                      >
                        Set as Main
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => removeImage(img.id)}
                      disabled={isBusy}
                      className="block w-full text-center text-[10px] font-medium text-red-600 hover:text-red-500 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
