"use client";

import { useState } from "react";
import { FilePreviewModal } from "./FilePreviewModal";

export interface GalleryImage {
  id: string;
  /** Inline-disposition URL, safe to render directly in an <img>. */
  url: string;
  /** Plain (forced-download) URL for the preview modal's Download button. */
  downloadUrl: string;
  fileName: string;
  mimeType: string;
}

interface ProductImageGalleryProps {
  /** The first entry is shown pre-selected — callers should put the item's
   * own "main" image first, then every other image after it. */
  images: GalleryImage[];
  altText: string;
}

/**
 * Ecommerce-style product gallery: one large image up top, every other image
 * (including the main one) as a row of small clickable thumbnails below it —
 * clicking a thumbnail swaps which image is shown large, clicking the large
 * image itself opens the existing shared full-screen FilePreviewModal.
 */
export function ProductImageGallery({ images, altText }: ProductImageGalleryProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const active = images[activeIndex] ?? null;

  if (!active) {
    return (
      <div className="flex h-72 w-full items-center justify-center rounded-lg border border-dashed border-zinc-300 text-sm text-zinc-400 dark:border-zinc-700">
        No images uploaded yet.
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setPreviewOpen(true)}
        className="flex h-72 w-full cursor-zoom-in items-center justify-center overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 sm:h-96"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={active.url} alt={altText} className="h-full w-full object-contain" />
      </button>

      {images.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {images.map((img, index) => (
            <button
              key={img.id}
              type="button"
              onClick={() => setActiveIndex(index)}
              aria-label={`Show image ${index + 1}`}
              className={`h-16 w-16 shrink-0 overflow-hidden rounded-md border-2 transition-colors ${
                index === activeIndex
                  ? "border-indigo-500"
                  : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-700 dark:hover:border-zinc-600"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt={`${altText} ${index + 1}`} className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {previewOpen && (
        <FilePreviewModal
          key={active.id}
          open
          onClose={() => setPreviewOpen(false)}
          previewUrl={active.url}
          downloadUrl={active.downloadUrl}
          fileName={active.fileName}
          mimeType={active.mimeType}
        />
      )}
    </div>
  );
}
