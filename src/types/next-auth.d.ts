import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      /** The company currently being acted on. Fixed for an ordinary user;
       * switchable for a platform admin via the sidebar's company switcher
       * (useSession().update({ companyId })) — see auth.config.ts's jwt
       * callback. Every service/route derives actor.companyId from this. */
      companyId: string;
      /** The company this account actually belongs to — never changes for
       * the life of the session, regardless of any company switch above. */
      homeCompanyId: string;
      defaultBranchId: string | null;
      /** Convenience flag only — always re-verified live from the DB before
       * a platform-level action (requirePlatformAdmin()) or an ordinary
       * PermissionService.can() check (its own full-access bypass for
       * platform admins), never trusted from the JWT alone. See
       * User.isPlatformAdmin. */
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
    homeCompanyId: string;
    defaultBranchId: string | null;
    isPlatformAdmin: boolean;
    sessionIssuedAt: number;
  }
}
