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
    jwt: async ({ token, user }) => {
      if (user) {
        token.userId = user.id;
        token.companyId = (user as { companyId: string }).companyId;
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
      return token;
    },
    session: async ({ session, token }) => {
      if (session.user) {
        session.user.id = token.userId as string;
        session.user.companyId = token.companyId as string;
        session.user.defaultBranchId = token.defaultBranchId as string | null;
        session.user.isPlatformAdmin = token.isPlatformAdmin as boolean;
        session.user.sessionIssuedAt = token.sessionIssuedAt as number;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
