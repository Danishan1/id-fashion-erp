"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface NotificationRow {
  id: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const load = () =>
    fetch("/api/v1/notifications")
      .then((res) => res.json())
      .then((body) => {
        setNotifications(body.data ?? []);
        setUnreadCount(body.meta?.unreadCount ?? 0);
      });

  useEffect(() => {
    load();
  }, []);

  const toggleOpen = () => {
    setOpen((o) => !o);
    if (!open) load();
  };

  const markRead = async (id: string) => {
    await fetch(`/api/v1/notifications/${id}/read`, { method: "PATCH" });
    load();
  };

  const markAllRead = async () => {
    await fetch("/api/v1/notifications/mark-all-read", { method: "POST" });
    load();
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggleOpen}
        className="relative rounded-md border border-zinc-300 px-2.5 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        aria-label="Notifications"
      >
        🔔
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-medium text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
            <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Notifications</span>
            {unreadCount > 0 && (
              <button type="button" onClick={markAllRead} className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="p-4 text-sm text-zinc-500">No notifications yet.</p>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => !n.isRead && markRead(n.id)}
                  className={`block w-full border-b border-zinc-100 px-3 py-2 text-left text-sm last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60 ${
                    n.isRead ? "text-zinc-500" : "text-zinc-900 dark:text-zinc-50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{n.title}</span>
                    {!n.isRead && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-600" />}
                  </div>
                  <p className="mt-0.5 text-xs">{n.body}</p>
                  <p className="mt-0.5 text-[11px] text-zinc-400">{new Date(n.createdAt).toLocaleString()}</p>
                </button>
              ))
            )}
          </div>
          <div className="border-t border-zinc-100 px-3 py-2 dark:border-zinc-800">
            <Link href="/follow-ups" onClick={() => setOpen(false)} className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
              View all follow-ups →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
