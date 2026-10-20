-- P2 (2026-10-21): force a password change after a temporary password
-- (login created from Employee Master, or an admin password reset).
ALTER TABLE "users" ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;
