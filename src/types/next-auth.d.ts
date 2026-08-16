import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      companyId: string;
      defaultBranchId: string | null;
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
  }
}
