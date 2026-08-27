import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      companyId: string;
      defaultBranchId: string | null;
      /** Convenience flag only — always re-verified live from the DB before
       * a platform-level action (requirePlatformAdmin()), never trusted from
       * the JWT alone. See User.isPlatformAdmin. */
      isPlatformAdmin: boolean;
      /** Unix seconds this session's JWT was issued — lets a password
       * change invalidate sessions that predate it. See CF-7/passwordChangedAt. */
      sessionIssuedAt: number;
    } & DefaultSession["user"];
  }

  interface User {
    companyId: string;
    defaultBranchId: string | null;
    isPlatformAdmin: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId: string;
    companyId: string;
    defaultBranchId: string | null;
    isPlatformAdmin: boolean;
    sessionIssuedAt: number;
  }
}
