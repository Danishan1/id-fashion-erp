"use client";

/**
 * Message thread of a support ticket (Platform SaaS Phase 5). Shared by the
 * customer ERP page and the platform inbox; each passes its own author
 * labels and attachment download base URL.
 */

export interface ThreadAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
}

export interface ThreadMessage {
  id: string;
  authorType: "CUSTOMER" | "PLATFORM";
  authorLabel: string;
  body: string;
  isInternal: boolean;
  createdAt: string;
  attachments: ThreadAttachment[];
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

function size(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function TicketThread({
  messages,
  attachmentBaseUrl,
  ownSide,
}: {
  messages: ThreadMessage[];
  /** e.g. "/api/v1/support-tickets/attachments" */
  attachmentBaseUrl: string;
  /** Messages from this side are drawn on the right. */
  ownSide: "CUSTOMER" | "PLATFORM";
}) {
  return (
    <ol className="space-y-3">
      {messages.map((m) => {
        const own = m.authorType === ownSide;
        const tone = m.isInternal
          ? "border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10"
          : own
            ? "border-indigo-200 bg-indigo-50 dark:border-indigo-500/30 dark:bg-indigo-500/10"
            : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900";
        return (
          <li key={m.id} className={`flex ${own ? "justify-end" : "justify-start"}`}>
            <div className={`w-full max-w-2xl rounded-lg border p-3 text-sm ${tone}`}>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
                <span className="font-medium text-zinc-700 dark:text-zinc-200">
                  {m.authorLabel}
                  {m.isInternal && (
                    <span className="ml-2 rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:bg-amber-500/20 dark:text-amber-200">
                      Internal note
                    </span>
                  )}
                </span>
                <span>{fmt(m.createdAt)}</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-zinc-800 dark:text-zinc-100">{m.body}</p>
              {m.attachments.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {m.attachments.map((a) => (
                    <li key={a.id}>
                      <a
                        href={`${attachmentBaseUrl}/${a.id}`}
                        className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-indigo-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-indigo-300"
                      >
                        📎 {a.fileName} <span className="text-zinc-500">({size(a.fileSizeBytes)})</span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const STATUS_STYLES: Record<string, string> = {
  OPEN: "bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300",
  IN_PROGRESS: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300",
  WAITING_ON_CUSTOMER: "bg-amber-100 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300",
  RESOLVED: "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400",
  CLOSED: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

export function TicketStatusBadge({ status, label }: { status: string; label: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status] ?? STATUS_STYLES.CLOSED}`}>{label}</span>;
}

const PRIORITY_STYLES: Record<string, string> = {
  LOW: "text-zinc-500",
  NORMAL: "text-zinc-700 dark:text-zinc-300",
  HIGH: "text-orange-600 dark:text-orange-400",
  URGENT: "font-semibold text-red-600 dark:text-red-400",
};

export function TicketPriorityText({ priority, label }: { priority: string; label: string }) {
  return <span className={PRIORITY_STYLES[priority] ?? ""}>{label}</span>;
}

/** Text + file picker used to write a message (new ticket, reply, platform note). */
export function FilePicker({ files, onChange, max }: { files: File[]; onChange: (files: File[]) => void; max: number }) {
  return (
    <div className="text-sm">
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
        Attach files
        <input
          type="file"
          multiple
          className="hidden"
          accept=".jpg,.jpeg,.png,.webp,.pdf,.xlsx,.xls,.docx,.doc,.csv"
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            onChange([...files, ...picked].slice(0, max));
            e.target.value = "";
          }}
        />
      </label>
      <span className="ml-2 text-xs text-zinc-500">Images, PDF, Excel, Word or CSV · up to {max} files, 20 MB each</span>
      {files.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-1 text-xs dark:bg-zinc-800"
            >
              {f.name}
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                onClick={() => onChange(files.filter((_, j) => j !== i))}
                className="text-zinc-500 hover:text-red-600"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
