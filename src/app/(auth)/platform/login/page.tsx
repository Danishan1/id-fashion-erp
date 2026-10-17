"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { toast } from "@/components/ui/Toast";

import { EyeIcon, EyeOffIcon } from "@/components/ui/icons";

/**
 * Platform operator sign-in (Platform SaaS Phase 1, PLAT-002). Uses the
 * separate "platform-credentials" provider, which checks platform_users
 * only — a customer's ERP login can't sign in here, and a platform account
 * can't sign in at /login.
 */
export default function PlatformLoginPage() {
  return (
    <Suspense>
      <PlatformLoginForm />
    </Suspense>
  );
}

function safeCallbackUrl(raw: string | null): string {
  // Only ever return into the platform portal.
  return raw && raw.startsWith("/platform") && !raw.startsWith("/platform/login") ? raw : "/platform";
}

function PlatformLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = safeCallbackUrl(searchParams.get("callbackUrl"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    const result = await signIn("platform-credentials", { email, password, redirect: false });

    setIsSubmitting(false);

    if (result?.error) {
      setError("Invalid email or password.");
      toast.error("Invalid email or password.");
      return;
    }

    router.push(callbackUrl);
    router.refresh();
  };

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-900 px-4">
      <div className="w-full max-w-sm rounded-lg border border-zinc-700 bg-zinc-800 p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-zinc-50">Platform Administration</h1>
        <p className="mt-1 text-sm text-zinc-400">Sign in with your platform operator account</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-zinc-300">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full rounded-md border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-zinc-300">
              Password
            </label>
            <div className="relative mt-1">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="block w-full rounded-md border border-zinc-600 bg-zinc-900 px-3 py-2 pr-10 text-sm text-zinc-100 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-zinc-400 hover:text-zinc-200 focus:outline-none"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-60"
          >
            {isSubmitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
