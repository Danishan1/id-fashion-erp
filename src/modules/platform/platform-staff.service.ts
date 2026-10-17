import { prisma } from "@/core/db/client";
import { hashPassword } from "@/core/auth/password";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { PlatformUserRole, UserStatus } from "@prisma/client";

export interface PlatformActor {
  platformUserId: string;
}

export interface CreatePlatformStaffInput {
  email: string;
  fullName: string;
  role: PlatformUserRole;
  password: string;
}

export interface UpdatePlatformStaffInput {
  fullName?: string;
  role?: PlatformUserRole;
  status?: UserStatus;
}

/** Lists all platform operators (Super Admins, Support Agents, Billing Admins). */
export async function listPlatformStaff() {
  const staff = await prisma.platformUser.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      status: true,
      lastLoginAt: true,
      createdAt: true,
    },
  });

  return staff;
}

/** Creates a new platform operator. Restricted to PLATFORM_SUPER_ADMIN. */
export async function createPlatformStaff(_actor: PlatformActor, input: CreatePlatformStaffInput) {
  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    throw new BusinessRuleError("VALIDATION_ERROR", "A valid email address is required.");
  }
  if (!input.fullName.trim()) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Full name is required.");
  }
  if (!input.password || input.password.length < 8) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Password must be at least 8 characters long.");
  }

  const existing = await prisma.platformUser.findUnique({ where: { email } });
  if (existing) {
    throw new BusinessRuleError("DUPLICATE_EMAIL_EXISTS", `A platform operator with email "${email}" already exists.`);
  }

  const passwordHash = await hashPassword(input.password);

  const newUser = await prisma.platformUser.create({
    data: {
      email,
      fullName: input.fullName.trim(),
      role: input.role,
      passwordHash,
      status: "ACTIVE",
    },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      status: true,
      createdAt: true,
    },
  });

  return newUser;
}

/** Updates an existing platform operator. */
export async function updatePlatformStaff(actor: PlatformActor, id: string, input: UpdatePlatformStaffInput) {
  const existing = await prisma.platformUser.findUnique({ where: { id } });
  if (!existing) {
    throw new BusinessRuleError("NOT_FOUND", "Platform operator not found.");
  }

  // Prevent self-suspension
  if (input.status === "SUSPENDED" && actor.platformUserId === id) {
    throw new BusinessRuleError("PERMISSION_DENIED", "You cannot suspend your own platform account.");
  }

  // Ensure at least one active super admin remains
  if (
    (input.status === "SUSPENDED" || (input.role && input.role !== "PLATFORM_SUPER_ADMIN")) &&
    existing.role === "PLATFORM_SUPER_ADMIN" &&
    existing.status === "ACTIVE"
  ) {
    const superAdminCount = await prisma.platformUser.count({
      where: {
        role: "PLATFORM_SUPER_ADMIN",
        status: "ACTIVE",
        id: { not: id },
      },
    });
    if (superAdminCount === 0) {
      throw new BusinessRuleError("PERMISSION_DENIED", "Cannot modify or suspend the only remaining active Platform Super Admin.");
    }
  }

  const updated = await prisma.platformUser.update({
    where: { id },
    data: {
      ...(input.fullName ? { fullName: input.fullName.trim() } : {}),
      ...(input.role ? { role: input.role } : {}),
      ...(input.status ? { status: input.status } : {}),
    },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      status: true,
      lastLoginAt: true,
      createdAt: true,
    },
  });

  return updated;
}

/** Resets a platform operator's password. */
export async function resetPlatformStaffPassword(
  _actor: PlatformActor,
  id: string,
  newPassword: string
) {
  const existing = await prisma.platformUser.findUnique({ where: { id } });
  if (!existing) {
    throw new BusinessRuleError("NOT_FOUND", "Platform operator not found.");
  }

  if (!newPassword || newPassword.length < 8) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Password must be at least 8 characters long.");
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.platformUser.update({
    where: { id },
    data: {
      passwordHash,
      passwordChangedAt: new Date(),
    },
  });

  return { success: true, email: existing.email };
}
