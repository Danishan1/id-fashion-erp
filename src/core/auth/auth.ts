import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/core/db/client";
import { verifyPassword } from "@/core/auth/password";
import { authConfig } from "@/core/auth/auth.config";
import { assertNotLockedOut, clearAttempts, recordFailedAttempt } from "@/core/auth/rateLimiter";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!email || !password) return null;

        // Keeps the existing "return null on any failure" contract intact —
        // lockout is just another failure reason, not a new error path.
        try {
          assertNotLockedOut(email);
        } catch {
          return null;
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || user.status !== "ACTIVE") {
          recordFailedAttempt(email);
          return null;
        }

        const passwordValid = await verifyPassword(password, user.passwordHash);
        if (!passwordValid) {
          recordFailedAttempt(email);
          return null;
        }

        clearAttempts(email);

        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        return {
          id: user.id,
          email: user.email,
          name: user.fullName,
          companyId: user.companyId,
          defaultBranchId: user.defaultBranchId,
        };
      },
    }),
  ],
});
