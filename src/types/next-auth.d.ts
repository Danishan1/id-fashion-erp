import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      /** TENANT = a customer company's user; PLATFORM = a platform operator
       * (platform_users); SUPPORT = a platform operator inside one company
       * through a customer-approved support session (id = that company's
       * support proxy user). See auth.config.ts / route-access.ts. */
      userType: "TENANT" | "PLATFORM" | "SUPPORT";
      /** The customer company this user belongs to. Empty string for a
       * PLATFORM session — those never reach tenant code (requireSession()
       * rejects them). Every service/route derives actor.companyId from this. */
      companyId: string;
      defaultBranchId: string | null;
      /** PlatformUserRole for a PLATFORM session, null otherwise. Convenience
       * only — requirePlatformSession() re-checks it live from the DB. */
      platformRole: string | null;
      /** The support session for a SUPPORT session, null otherwise. Re-checked
       * live on every request (revocation/expiry take effect immediately). */
      supportSessionId: string | null;
      /** Unix seconds this session's JWT was issued — lets a password
       * change invalidate sessions that predate it. See CF-7/passwordChangedAt. */
      sessionIssuedAt: number;
      /** P2: true while the user still has a temporary password. */
      mustChangePassword: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    userType?: "TENANT" | "PLATFORM" | "SUPPORT";
    companyId?: string;
    defaultBranchId?: string | null;
    platformRole?: string | null;
    supportSessionId?: string | null;
    mustChangePassword?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId: string;
    userType?: "TENANT" | "PLATFORM" | "SUPPORT";
    companyId?: string;
    defaultBranchId?: string | null;
    platformRole?: string;
    supportSessionId?: string;
    sessionIssuedAt: number;
    mustChangePassword?: boolean;
  }
}
