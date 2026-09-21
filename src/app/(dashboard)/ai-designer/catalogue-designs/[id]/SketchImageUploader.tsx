"use client";

function imageUrl(attachmentId: string) {
  return `/api/v1/ai-designer/attachments/${attachmentId}/download?disposition=inline`;
}

async function parseJson(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message ?? "Request failed.");
  return body;
}

interface Props {
  projectId: string;
  sketchImageAttachmentId: string | null;
  busy: string | null;
  run: (key: string, fn: () => Promise<unknown>) => Promise<void>;
}

/**
 * Sketch / Drawing → Garment, Step 1 — a single current sketch photo with
 * Replace/Remove, mirroring FabricSelection's own single-image upload shape
 * in this same file (not a multi-slot gallery like the foundation-phase
 * UploadStep component — this needs one definitive image for real vision
 * analysis, the same reasoning that already drove AI Garment Flow's Process
 * 1/Fabric Analysis to the same single-image shape).
 */
export function SketchImageUploader({ projectId, sketchImageAttachmentId, busy, run }: Props) {
  const upload = (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return run("upload-sketch", () =>
      fetch(`/api/v1/ai-designer/projects/${projectId}/sketch-image`, { method: "POST", body: formData }).then(parseJson)
    );
  };

  const remove = () =>
    run("delete-sketch", () => fetch(`/api/v1/ai-designer/projects/${projectId}/sketch-image`, { method: "DELETE" }).then(parseJson));

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">
        Upload a hand-drawn or digital sketch of the garment you want to create. This sketch becomes the
        PRIMARY design reference — its silhouette, proportions, neckline, sleeves, panels, seams, and every
        other visible construction detail are preserved when the garment is generated. The fabric you select
        in a later step only changes the material's appearance, never the garment's own structure.
      </p>

      {sketchImageAttachmentId ? (
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl(sketchImageAttachmentId)} alt="Uploaded sketch" className="h-40 w-40 rounded border object-contain bg-white" />
          <div className="space-y-2">
            <label className="block">
              <span className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400 cursor-pointer">Replace</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={busy === "upload-sketch"}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) upload(file);
                  e.target.value = "";
                }}
              />
            </label>
            <button
              type="button"
              disabled={busy === "delete-sketch"}
              onClick={remove}
              className="block text-xs text-red-600 hover:underline disabled:opacity-50"
            >
              {busy === "delete-sketch" ? "Removing…" : "Remove"}
            </button>
          </div>
        </div>
      ) : (
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy === "upload-sketch"}
          className="block w-full text-sm"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload(file);
            e.target.value = "";
          }}
        />
      )}
    </div>
  );
}
