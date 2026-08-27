import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe subset of the NextAuth config — no providers (Credentials pulls in
 * Prisma + bcrypt, which are Node-only) so this can be used directly in
 * middleware, which runs on the Edge runtime. The full config in auth.ts
 * spreads this and adds providers for use in route handlers/server components.
 */
export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const isLoggedIn = !!auth?.user;
      const isLoginPage = request.nextUrl.pathname === "/login";

      if (!isLoggedIn && !isLoginPage) return false;
      if (isLoggedIn && isLoginPage) {
        return Response.redirect(new URL("/dashboard", request.nextUrl.origin));
      }
      return true;
    },
    jwt: async ({ token, user, trigger, session }) => {
      if (user) {
        token.userId = user.id;
        token.companyId = (user as { companyId: string }).companyId;
        // The company this account actually belongs to — fixed for life,
        // never touched by a company switch below. Lets the sidebar's
        // switcher offer a "back to my own company" shortcut and lets a
        // platform admin always tell which company they're really acting as
        // vs. just currently viewing.
        token.homeCompanyId = (user as { companyId: string }).companyId;
        token.defaultBranchId = (user as { defaultBranchId: string | null }).defaultBranchId;
        // Convenience only — requirePlatformAdmin() re-checks this live from
        // the DB before anything platform-level actually happens, the same
        // "never trust the JWT alone" discipline as status/passwordChangedAt.
        token.isPlatformAdmin = (user as { isPlatformAdmin: boolean }).isPlatformAdmin;
        // Stamped only at sign-in (when `user` is present), not on every
        // token refresh — this is the session's own age, used to detect a
        // session that predates a password change (User.passwordChangedAt).
        token.sessionIssuedAt = Math.floor(Date.now() / 1000);
      }
      // Lets a platform admin re-scope their own session to a different
      // company via useSession().update({ companyId }) (the sidebar company
      // switcher) — every service/route derives actor.companyId from
      // session.user.companyId, so this alone is what makes the switch
      // actually change which company's data is visible. Gated on the
      // token's own isPlatformAdmin flag as a convenience check only: this
      // callback is Edge-safe (no Prisma access), so the real gate is
      // PermissionService.can()'s independent, live-from-the-DB
      // isPlatformAdmin re-check on every subsequent request — a forged
      // update() call from a non-platform-admin session achieves nothing
      // beyond changing a JWT field that nothing else trusts on its own.
      if (trigger === "update" && token.isPlatformAdmin && typeof (session as { companyId?: unknown })?.companyId === "string") {
        token.companyId = (session as { companyId: string }).companyId;
      }
      return token;
    },
    session: async ({ session, token }) => {
      if (session.user) {
        session.user.id = token.userId as string;
        session.user.companyId = token.companyId as string;
        session.user.homeCompanyId = token.homeCompanyId as string;
        session.user.defaultBranchId = token.defaultBranchId as string | null;
        session.user.isPlatformAdmin = token.isPlatformAdmin as boolean;
        session.user.sessionIssuedAt = token.sessionIssuedAt as number;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
