"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Modal } from "@/components/ui/Modal";
import { apiJson, Card, ErrorText, fmtDateTime } from "../../_shared/attendance-ui";

interface FaceData {
  employee: { id: string; fullName: string; employeeCode: string };
  photos: { id: string; fileName: string; sizeBytes: number; createdAt: string }[];
  max: number;
}

export function FaceEnrolmentClient({ employeeId }: { employeeId: string }) {
  const [data, setData] = useState<FaceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [camera, setCamera] = useState(false);
  const [inputKey, setInputKey] = useState(0);

  const load = useCallback(() => {
    apiJson<FaceData>(`/api/v1/attendance/face-photos/${employeeId}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [employeeId]);
  useEffect(() => {
    load();
  }, [load]);

  const upload = async (list: File[]) => {
    if (list.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      list.forEach((f) => form.append("photos", f));
      await apiJson(`/api/v1/attendance/face-photos/${employeeId}`, { method: "POST", body: form });
      setFiles([]);
      setInputKey((k) => k + 1);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const remove = async () => {
    const id = deleting;
    setDeleting(null);
    if (!id) return;
    try {
      await apiJson(`/api/v1/attendance/face-photos/file/${id}`, { method: "DELETE" });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remaining = data ? data.max - data.photos.length : 0;

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Attendance Settings", href: "/attendance/settings" },
          { label: data ? `Face photos — ${data.employee.fullName}` : "Face photos" },
        ]}
      />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Face enrolment {data && `— ${data.employee.fullName} (${data.employee.employeeCode})`}</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Up to 3 clear, front-facing photos with good light. The employee&apos;s live face is matched against these when they punch.
        </p>
      </div>
      <ErrorText message={error} />
      {data && (
        <>
          <Card title={`Enrolled photos (${data.photos.length}/${data.max})`}>
            {data.photos.length === 0 ? (
              <p className="text-sm text-zinc-500">No photos yet — this employee can&apos;t punch while face match is required.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {data.photos.map((p) => (
                  <div key={p.id} className="overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/v1/attendance/face-photos/file/${p.id}`} alt="Enrolled face" className="aspect-square w-full object-cover" />
                    <div className="flex items-center justify-between p-2 text-xs text-zinc-500">
                      <span>{fmtDateTime(p.createdAt)}</span>
                      <button type="button" className="font-medium text-red-600 hover:text-red-500" onClick={() => setDeleting(p.id)}>
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
          {remaining > 0 && (
            <Card title="Add photos">
              <div className="flex flex-wrap items-center gap-3">
                <input key={inputKey} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, remaining))} />
                <Button onClick={() => upload(files)} disabled={files.length === 0} isLoading={uploading} loadingLabel="Uploading…">
                  Upload {files.length > 0 ? `(${files.length})` : ""}
                </Button>
                <Button variant="secondary" onClick={() => setCamera(true)}>
                  Take photo with camera
                </Button>
              </div>
              <p className="mt-2 text-xs text-zinc-500">You can add {remaining} more.</p>
            </Card>
          )}
        </>
      )}
      <ConfirmModal open={deleting !== null} title="Remove this face photo?" message="The employee will be matched against the remaining photos only." confirmLabel="Remove" isDangerous onConfirm={remove} onCancel={() => setDeleting(null)} />
      <Modal open={camera} onClose={() => setCamera(false)} title="Take face photo" maxWidthClass="max-w-lg">
        {camera && (
          <CameraCapture
            onCapture={async (file) => {
              setCamera(false);
              await upload([file]);
            }}
            onCancel={() => setCamera(false)}
          />
        )}
      </Modal>
    </div>
  );
}

function CameraCapture({ onCapture, onCancel }: { onCapture: (file: File) => void; onCancel: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "user", width: 640, height: 480 }, audio: false })
      .then((s) => {
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          videoRef.current.play().catch(() => undefined);
        }
      })
      .catch((e) => setError(`Camera permission is needed (${e.message}).`));
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);

  const snap = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0);
    canvas.toBlob((b) => b && onCapture(new File([b], `face_${Date.now()}.jpg`, { type: "image/jpeg" })), "image/jpeg", 0.9);
  };

  return (
    <div className="space-y-3">
      <ErrorText message={error} />
      <video ref={videoRef} playsInline muted className="w-full -scale-x-100 rounded-md bg-black" />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={snap}>Capture</Button>
      </div>
    </div>
  );
}
