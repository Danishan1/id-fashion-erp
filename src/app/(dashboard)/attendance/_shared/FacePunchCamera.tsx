"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, buttonClasses } from "@/components/ui/Button";

/**
 * Live selfie + GPS + face match, ported from the old FaceRecognition.jsx:
 * tiny face detector (input 320, score 0.6) + 68 landmarks + recognition
 * net; a punch is sent only after `frames` consecutive frames match one of
 * the employee's enrolled photos within `threshold` (Euclidean distance).
 * GPS must reach the required accuracy first.
 */

type FaceApi = typeof import("@vladmandic/face-api/dist/face-api.esm.js");

let faceApiPromise: Promise<FaceApi> | null = null;
function loadFaceApi(): Promise<FaceApi> {
  if (!faceApiPromise) {
    faceApiPromise = (async () => {
      const faceapi = await import("@vladmandic/face-api/dist/face-api.esm.js");
      const base = "/models/face-api";
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(base),
        faceapi.nets.faceLandmark68Net.loadFromUri(base),
        faceapi.nets.faceRecognitionNet.loadFromUri(base),
      ]);
      return faceapi;
    })().catch((e) => {
      faceApiPromise = null;
      throw e;
    });
  }
  return faceApiPromise;
}

const DESCRIPTOR_CACHE_PREFIX = "attendance_face_descriptors_v1_";

async function loadDescriptors(faceapi: FaceApi, photoIds: string[]) {
  const cacheKey = DESCRIPTOR_CACHE_PREFIX + photoIds.join(",");
  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as { id: string; d: number[] }[];
      return parsed.map((p) => new faceapi.LabeledFaceDescriptors(p.id, [new Float32Array(p.d)]));
    }
  } catch {
    /* ignore storage errors */
  }
  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
  const out: { id: string; d: number[] }[] = [];
  for (const id of photoIds) {
    const res = await fetch(`/api/v1/attendance/face-photos/file/${id}`);
    if (!res.ok) continue;
    const img = await faceapi.bufferToImage(await res.blob());
    const det = await faceapi.detectSingleFace(img, options).withFaceLandmarks().withFaceDescriptor();
    if (det) out.push({ id, d: Array.from(det.descriptor) });
  }
  try {
    sessionStorage.setItem(cacheKey, JSON.stringify(out));
  } catch {
    /* ignore */
  }
  return out.map((p) => new faceapi.LabeledFaceDescriptors(p.id, [new Float32Array(p.d)]));
}

export interface PunchCapture {
  selfie: Blob;
  latitude: number;
  longitude: number;
  accuracy: number;
  facePhotoId: string | null;
}

interface Props {
  type: "IN" | "OUT";
  facePhotoIds: string[];
  requireFace: boolean;
  threshold: number;
  frames: number;
  gpsAccuracyMeters: number;
  /** Set when the viewer may enrol face photos for this employee (HR / Admin / Super Admin). */
  enrolHref?: string | null;
  onCapture: (capture: PunchCapture) => Promise<void>;
  onCancel: () => void;
}

export function FacePunchCamera({ type, facePhotoIds, requireFace, threshold, frames, gpsAccuracyMeters, enrolHref = null, onCapture, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState("Starting camera…");
  const [error, setError] = useState<string | null>(null);
  const [gps, setGps] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [matchCount, setMatchCount] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const gpsRef = useRef<{ lat: number; lng: number; accuracy: number } | null>(null);
  const doneRef = useRef(false);

  const useFace = facePhotoIds.length > 0;
  const blocked = requireFace && !useFace;

  // Camera
  useEffect(() => {
    if (blocked) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("This browser can't open the camera. Use Chrome or Safari over HTTPS.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 640, height: 480 }, audio: false });
        if (cancelled) return;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setStatus(useFace ? "Loading face models…" : "Camera ready.");
      } catch (e) {
        setError(`Camera permission is needed to punch (${(e as Error).message}).`);
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [blocked, useFace]);

  // GPS
  useEffect(() => {
    if (blocked || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
        if (!gpsRef.current || next.accuracy <= gpsRef.current.accuracy) {
          gpsRef.current = next;
          setGps(next);
        }
      },
      (err) => setError(`Location permission is needed to punch (${err.message}).`),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [blocked]);

  const gpsOk = !!gps && gps.accuracy <= gpsAccuracyMeters;
  const noGeolocation = typeof navigator !== "undefined" && !navigator.geolocation;

  const captureSelfie = (): Promise<Blob> =>
    new Promise((resolve, reject) => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || !video.videoWidth) return reject(new Error("Camera is not ready yet."));
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d")!;
      // Mirror, as the old system did, so the photo matches what the user saw.
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not capture the photo."))), "image/jpeg", 0.85);
    });

  const submit = async (facePhotoId: string | null) => {
    if (doneRef.current) return;
    const g = gpsRef.current;
    if (!g || g.accuracy > gpsAccuracyMeters) return;
    doneRef.current = true;
    setSubmitting(true);
    try {
      const selfie = await captureSelfie();
      setStatus("Saving punch…");
      await onCapture({ selfie, latitude: g.lat, longitude: g.lng, accuracy: g.accuracy, facePhotoId });
    } catch (e) {
      doneRef.current = false;
      setSubmitting(false);
      setError((e as Error).message);
    }
  };

  // Face matching loop
  useEffect(() => {
    if (blocked || !useFace) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    (async () => {
      let faceapi: FaceApi;
      let matcher: InstanceType<FaceApi["FaceMatcher"]>;
      try {
        faceapi = await loadFaceApi();
        const labeled = await loadDescriptors(faceapi, facePhotoIds);
        if (labeled.length === 0) {
          setError("No face could be read from your enrolled photos. Ask HR to enrol clearer photos.");
          return;
        }
        matcher = new faceapi.FaceMatcher(labeled, threshold);
      } catch (e) {
        setError(`Face models could not load: ${(e as Error).message}`);
        return;
      }
      if (stop) return;
      setStatus("Look straight at the camera…");
      const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.6 });
      let consecutive = 0;
      let lastLabel: string | null = null;
      const tick = async () => {
        if (stop || doneRef.current) return;
        const video = videoRef.current;
        if (video && video.readyState >= 2) {
          try {
            const det = await faceapi.detectSingleFace(video, options).withFaceLandmarks().withFaceDescriptor();
            if (det) {
              const best = matcher.findBestMatch(det.descriptor);
              if (best.label !== "unknown" && best.distance <= threshold) {
                consecutive = lastLabel === best.label ? consecutive + 1 : 1;
                lastLabel = best.label;
                setStatus(`Face matched (${consecutive}/${frames})…`);
              } else {
                consecutive = 0;
                lastLabel = null;
                setStatus("Verifying identity… please look directly at the camera.");
              }
            } else {
              consecutive = 0;
              setStatus("No face found — look straight at the camera.");
            }
            setMatchCount(consecutive);
            if (consecutive >= frames && lastLabel) {
              if (gpsRef.current && gpsRef.current.accuracy <= gpsAccuracyMeters) {
                await submit(lastLabel);
                if (doneRef.current) return;
                consecutive = 0; // the save failed — keep matching so the user can retry
              } else {
                setStatus("Face verified — waiting for an accurate GPS fix…");
              }
            }
          } catch {
            /* a bad frame — keep going */
          }
        }
        timer = setTimeout(tick, 250);
      };
      tick();
    })();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
    // submit is stable enough for this loop (it reads refs)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocked, useFace, facePhotoIds.join(","), threshold, frames, gpsAccuracyMeters]);

  if (blocked) {
    return (
      <div className="space-y-3">
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Your face photos are not enrolled yet, so you can&apos;t punch.{" "}
          {enrolHref
            ? "Enrol them now (up to 3 clear, front-facing photos), then punch again."
            : "Ask HR, Admin or Super Admin to enrol your photos in Attendance → Settings → Employees."}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Close
          </Button>
          {enrolHref && (
            <Link href={enrolHref} className={buttonClasses("primary", "sm")}>
              Enrol face photos
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-lg bg-black">
        <video ref={videoRef} playsInline muted className="h-auto w-full -scale-x-100" />
        {useFace && (
          <div className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-xs text-white">
            Match {matchCount}/{frames}
          </div>
        )}
      </div>
      <canvas ref={canvasRef} className="hidden" />
      <div className="space-y-1 text-sm">
        <p className="text-zinc-700 dark:text-zinc-200">{status}</p>
        <p className={gpsOk ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-300"}>
          {gps ? `GPS accuracy ${Math.round(gps.accuracy)} m ${gpsOk ? "✓" : `(needs ${gpsAccuracyMeters} m or better)`}` : "Getting your location…"}
        </p>
        {noGeolocation && <p className="rounded-md bg-red-50 px-3 py-2 text-red-700 dark:bg-red-950 dark:text-red-300">This browser can&apos;t share its location.</p>}
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        {!useFace && (
          <Button onClick={() => submit(null)} disabled={!gpsOk || submitting} isLoading={submitting} loadingLabel="Saving…">
            Take selfie & Punch {type === "IN" ? "In" : "Out"}
          </Button>
        )}
      </div>
    </div>
  );
}
