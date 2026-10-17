import type { NextAuthConfig } from "next-auth";
import { decideRouteAccess, type UserType } from "@/core/auth/route-access";

/**
 * Edge-safe subset of the NextAuth config — no providers (Credentials pulls in
 * Prisma + bcrypt, which are Node-only) so this can be used directly in
 * middleware, which runs on the Edge runtime. The full config in auth.ts
 * spreads this and adds providers for use in route handlers/server components.
 *
 * Two kinds of identity share one session cookie (Platform SaaS Phase 1):
 *  - TENANT: a customer company's user — has a companyId.
 *  - PLATFORM: a platform operator (platform_users) — has NO companyId and
 *    can't act inside any customer company.
 *  - SUPPORT: a platform operator inside ONE customer company through a
 *    customer-approved support session (Phase 2) — acts as that company's
 *    support proxy user, with the support session id re-checked live.
 * The middleware keeps each to its own part of the app (route-access.ts).
 */
export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const decision = decideRouteAccess(
        request.nextUrl.pathname,
        !!auth?.user,
        auth?.user?.userType as UserType | undefined
      );
      if (decision.kind === "redirect") return Response.redirect(new URL(decision.to, request.nextUrl.origin));
      return decision.kind === "allow";
    },
    jwt: async ({ token, user }) => {
      if (user) {
        const signedIn = user as {
          id: string;
          userType: UserType;
          companyId?: string;
          defaultBranchId?: string | null;
          platformRole?: string;
          supportSessionId?: string;
        };
        token.userId = signedIn.id;
        token.userType = signedIn.userType;
        if (signedIn.userType === "PLATFORM") {
          token.platformRole = signedIn.platformRole;
        } else {
          token.companyId = signedIn.companyId;
          token.defaultBranchId = signedIn.defaultBranchId ?? null;
          if (signedIn.userType === "SUPPORT") token.supportSessionId = signedIn.supportSessionId;
        }
        // Stamped only at sign-in (when `user` is present), not on every
        // token refresh — this is the session's own age, used to detect a
        // session that predates a password change.
        token.sessionIssuedAt = Math.floor(Date.now() / 1000);
      }
      // No `trigger === "update"` handling: a session can no longer be
      // re-pointed at another company (PLAT-005 removed the company switcher).
      return token;
    },
    session: async ({ session, token }) => {
      if (session.user) {
        session.user.id = token.userId as string;
        // Sessions issued before Phase 1 carry no userType; they could only
        // have come from the tenant login.
        session.user.userType = (token.userType as UserType | undefined) ?? "TENANT";
        // Empty for a platform session — requireSession() rejects platform
        // sessions before any code could use it.
        session.user.companyId = (token.companyId as string | undefined) ?? "";
        session.user.defaultBranchId = (token.defaultBranchId as string | null | undefined) ?? null;
        session.user.platformRole = (token.platformRole as string | undefined) ?? null;
        session.user.supportSessionId = (token.supportSessionId as string | undefined) ?? null;
        session.user.sessionIssuedAt = token.sessionIssuedAt as number;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
