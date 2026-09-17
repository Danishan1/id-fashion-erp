"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { FilePreviewModal } from "@/components/ui/FilePreviewModal";

interface ImageAttachment {
  id: string;
  fileName: string;
  mimeType: string;
}

interface ProductImagesSectionProps {
  productId: string;
  onClose: () => void;
}

function inlineUrl(id: string) {
  return `/api/v1/products/attachments/${id}/download?disposition=inline`;
}

function attachmentDownloadUrl(id: string) {
  return `/api/v1/products/attachments/${id}/download`;
}

/**
 * The Images modal's content, mounted only while it's the currently-open row
 * action — same "render only while open, let mount BE the reset" shape as
 * VariantsSection, triggered from the Styles list's inline row actions
 * (ProductsListClient.tsx) rather than its own trigger button.
 *
 * Split into two clearly separate concerns per explicit request: a single-
 * file "Main Image" slot (uploading here both adds the attachment AND sets
 * it as the designated cover image in one step) and a multi-file "Other
 * Images" gallery (any number of images at once, none of them automatically
 * main). Both still share the one underlying attachment bag and the one
 * existing single-file upload endpoint — a multi-select upload is
 * client-side orchestration (one POST per file), not a new backend route.
 */
export function ProductImagesSection({ productId, onClose }: ProductImagesSectionProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [mainImageAttachmentId, setMainImageAttachmentIdState] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [mainInputKey, setMainInputKey] = useState(0);
  const [otherInputKey, setOtherInputKey] = useState(0);
  const [previewTarget, setPreviewTarget] = useState<ImageAttachment | null>(null);

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

  async function uploadOne(file: File): Promise<{ id: string } | null> {
    if (!file.type.startsWith("image/")) {
      setError("Only image files (JPEG, PNG, WEBP) can be added to a style's gallery.");
      return null;
    }
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`/api/v1/products/${productId}/attachments`, { method: "POST", body: formData });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? `Failed to upload ${file.name}.`);
      return null;
    }
    const body = await res.json();
    return body.data;
  }

  async function handleUploadMain(file: File) {
    setIsBusy(true);
    setError(null);
    const uploaded = await uploadOne(file);
    if (!uploaded) {
      setIsBusy(false);
      setMainInputKey((k) => k + 1);
      return;
    }
    const res = await fetch(`/api/v1/products/${productId}/main-image`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attachmentId: uploaded.id }),
    });
    setIsBusy(false);
    setMainInputKey((k) => k + 1);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to set main image.");
      return;
    }
    setMainImageAttachmentIdState(uploaded.id);
    await load();
  }

  async function handleUploadOthers(files: FileList) {
    setIsBusy(true);
    setError(null);
    let failures = 0;
    for (const file of Array.from(files)) {
      const uploaded = await uploadOne(file);
      if (!uploaded) failures += 1;
    }
    setIsBusy(false);
    setOtherInputKey((k) => k + 1);
    if (failures > 0) {
      setError((prev) => prev ?? `${failures} of ${files.length} file(s) failed to upload.`);
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

  const mainImage = images.find((img) => img.id === mainImageAttachmentId) ?? null;
  const otherImages = images.filter((img) => img.id !== mainImageAttachmentId);

  return (
    <Modal open onClose={onClose} title="Style Images" maxWidthClass="max-w-2xl">
      <div className="space-y-5">
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        {isLoading ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : (
          <>
            <div>
              <p className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-200">Main Image</p>
              <div className="flex items-center gap-4">
                {mainImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={inlineUrl(mainImage.id)}
                    alt={mainImage.fileName}
                    onClick={() => setPreviewTarget(mainImage)}
                    className="h-24 w-24 cursor-zoom-in rounded-md border border-indigo-500 object-cover ring-2 ring-indigo-500"
                  />
                ) : (
                  <div className="flex h-24 w-24 items-center justify-center rounded-md border border-dashed border-zinc-300 text-xs text-zinc-400 dark:border-zinc-700">
                    None yet
                  </div>
                )}
                <label className="inline-block cursor-pointer rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
                  {mainImage ? "Replace Main Image" : "Upload Main Image"}
                  <input
                    key={mainInputKey}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={isBusy}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleUploadMain(file);
                    }}
                  />
                </label>
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Other Images</p>
                <label className="inline-block cursor-pointer rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
                  Upload Images
                  <input
                    key={otherInputKey}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    disabled={isBusy}
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) void handleUploadOthers(e.target.files);
                    }}
                  />
                </label>
              </div>

              {otherImages.length === 0 ? (
                <p className="text-sm text-zinc-500">No other images uploaded yet.</p>
              ) : (
                <div className="grid grid-cols-4 gap-3">
                  {otherImages.map((img) => (
                    <div key={img.id} className="overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={inlineUrl(img.id)}
                        alt={img.fileName}
                        onClick={() => setPreviewTarget(img)}
                        className="h-24 w-full cursor-zoom-in object-cover"
                      />
                      <div className="space-y-1 p-1.5">
                        <button
                          type="button"
                          onClick={() => setMainImage(img.id)}
                          disabled={isBusy}
                          className="block w-full rounded border border-zinc-300 px-1.5 py-0.5 text-[10px] font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                        >
                          Set as Main
                        </button>
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
                  ))}
                </div>
              )}
            </div>
          </>
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
    </Modal>
  );
}
