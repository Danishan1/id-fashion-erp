"use client";

import { signOut } from "next-auth/react";
import { useState, type FormEvent } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";

export function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setError(null);
    setSuccess(false);

    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/v1/account/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? "Failed to change password.");
        return;
      }

      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-md space-y-4">
      <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <FormField label="Current Password" htmlFor="currentPassword" required>
          <input
            id="currentPassword"
            type="password"
            required
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className={textInputClass()}
          />
        </FormField>
        <FormField label="New Password" htmlFor="newPassword" required>
          <input
            id="newPassword"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className={textInputClass()}
          />
        </FormField>
        <FormField label="Confirm New Password" htmlFor="confirmPassword" required>
          <input
            id="confirmPassword"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className={textInputClass()}
          />
        </FormField>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {success && (
          <p className="text-sm text-emerald-600 dark:text-emerald-400">
            Password changed. Signing you out so you can sign back in with your new password…
          </p>
        )}

        <button
          type="submit"
          disabled={isSubmitting || success}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {isSubmitting ? "Saving…" : "Change Password"}
        </button>
      </form>
      {success && (
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="text-sm text-indigo-600 underline hover:text-indigo-500 dark:text-indigo-400"
        >
          Sign out now
        </button>
      )}
    </div>
  );
}
