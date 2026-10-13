import type { PlatformUserRole } from "@prisma/client";
import { auth } from "@/core/auth/auth";
import { prisma } from "@/core/db/client";

export interface PlatformPageUser {
  id: string;
  fullName: string;
  email: string;
  role: PlatformUserRole;
}

/**
 * For Server Components in the /platform portal. Returns the signed-in
 * platform operator, re-checked live from platform_users (status and
 * password change), or null when the session isn't a valid platform session.
 * The middleware already keeps tenant users out of /platform; this is the
 * server-side re-check, so pages never trust the JWT alone.
 */
export async function getPlatformPageUser(): Promise<PlatformPageUser | null> {
  const session = await auth();
  if (!session?.user || session.user.userType !== "PLATFORM") return null;

  const user = await prisma.platformUser.findUnique({
    where: { id: session.user.id },
    select: { id: true, fullName: true, email: true, role: true, status: true, passwordChangedAt: true },
  });
  if (!user || user.status !== "ACTIVE") return null;
  if (user.passwordChangedAt && session.user.sessionIssuedAt * 1000 < user.passwordChangedAt.getTime()) return null;

  return { id: user.id, fullName: user.fullName, email: user.email, role: user.role };
}
