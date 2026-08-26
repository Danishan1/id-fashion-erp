import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      companyId: string;
      defaultBranchId: string | null;
      /** Unix seconds this session's JWT was issued — lets a password
       * change invalidate sessions that predate it. See CF-7/passwordChangedAt. */
      sessionIssuedAt: number;
    } & DefaultSession["user"];
  }

  interface User {
    companyId: string;
    defaultBranchId: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId: string;
    companyId: string;
    defaultBranchId: string | null;
    sessionIssuedAt: number;
  }
}
