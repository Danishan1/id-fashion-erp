import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "@/core/auth/auth.config";
import { authenticatePlatformUser, authenticateSupportSession, authenticateTenantUser } from "@/core/auth/authenticate";

const credentialFields = {
  email: { label: "Email", type: "email" },
  password: { label: "Password", type: "password" },
};

function readCredentials(credentials: Partial<Record<string, unknown>> | undefined) {
  const email = credentials?.email as string | undefined;
  const password = credentials?.password as string | undefined;
  return email && password ? { email, password } : null;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    // Customer (tenant) users — /login.
    Credentials({
      id: "credentials",
      credentials: credentialFields,
      authorize: async (credentials) => {
        const input = readCredentials(credentials);
        return input ? authenticateTenantUser(input.email, input.password) : null;
      },
    }),
    // Platform operators — /platform/login only (PLAT-002). Checks the
    // separate platform_users table; never the tenant users table.
    Credentials({
      id: "platform-credentials",
      credentials: credentialFields,
      authorize: async (credentials) => {
        const input = readCredentials(credentials);
        return input ? authenticatePlatformUser(input.email, input.password) : null;
      },
    }),
    // Customer-approved support sessions (PLAT-011). Takes only the
    // single-use exchange token the platform portal issued — never a
    // password — and signs the browser in as the company's support proxy user.
    Credentials({
      id: "support-session",
      credentials: { token: { label: "Token", type: "text" } },
      authorize: async (credentials) => {
        const token = credentials?.token;
        return typeof token === "string" && token.length > 0 ? authenticateSupportSession(token) : null;
      },
    }),
  ],
});
