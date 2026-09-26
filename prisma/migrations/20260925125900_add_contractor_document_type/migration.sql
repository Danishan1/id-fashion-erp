-- Split out from 20260925130000_add_contractor_master's own migration into
-- its own separate migration folder — Postgres refuses to use a new enum
-- value within the same transaction it was added in ("unsafe use of new
-- value... must be committed before they can be used"), and every
-- migration folder in this project runs as its own transaction under
-- `prisma migrate deploy`, so the enum addition genuinely needs to be a
-- separate, earlier-applied migration, not just a workaround for the
-- interactive `db execute` apply step.
ALTER TYPE "DocumentType" ADD VALUE 'CONTRACTOR';
