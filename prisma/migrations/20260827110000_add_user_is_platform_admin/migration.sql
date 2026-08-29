-- Platform-level admin capability, layered on top of (not part of) the
-- existing per-company RBAC — lets a user provision brand-new, independent
-- companies. Defaults false so no existing account gains it automatically.
ALTER TABLE "users" ADD COLUMN "is_platform_admin" BOOLEAN NOT NULL DEFAULT false;
