-- CRM Phase 10 — Calendar & Appointments.
-- Appointments are CRM activities of type APPOINTMENT (Phase 09 table
-- crm_activities); this adds the appointment-only columns, moves existing
-- appointments to the appointment lifecycle, and adds calendar indexes.

ALTER TABLE "crm_activities"
  ADD COLUMN "timezone" TEXT,
  ADD COLUMN "video_link" TEXT,
  ADD COLUMN "appointment_type" TEXT,
  ADD COLUMN "confirmed_at" TIMESTAMP(3),
  ADD COLUMN "confirmed_by_user_id" UUID,
  ADD COLUMN "cancelled_at" TIMESTAMP(3),
  ADD COLUMN "cancelled_by_user_id" UUID,
  ADD COLUMN "cancel_reason" TEXT,
  ADD COLUMN "no_show_at" TIMESTAMP(3),
  ADD COLUMN "no_show_by_user_id" UUID,
  ADD COLUMN "no_show_reason" TEXT;

-- Status: task statuses for other activities, the appointment lifecycle for appointments.
ALTER TABLE "crm_activities" DROP CONSTRAINT "crm_activities_status_check";

-- Existing (Phase 09) appointments: open → SCHEDULED; entered in business time;
-- a timed appointment without an end gets the default one-hour length.
UPDATE "crm_activities"
SET "status" = CASE WHEN "status" IN ('PENDING', 'IN_PROGRESS') THEN 'SCHEDULED' ELSE "status" END,
    "timezone" = COALESCE("timezone", 'Asia/Kolkata'),
    "end_at" = CASE WHEN "end_at" IS NULL AND "due_at" IS NOT NULL AND NOT "all_day" THEN "due_at" + INTERVAL '60 minutes' ELSE "end_at" END,
    "cancelled_at" = CASE WHEN "status" = 'CANCELLED' THEN COALESCE("cancelled_at", "updated_at") ELSE "cancelled_at" END
WHERE "type" = 'APPOINTMENT';

ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_status_check" CHECK (
  ("type" = 'APPOINTMENT' AND "status" IN ('SCHEDULED', 'CONFIRMED', 'RESCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'))
  OR ("type" <> 'APPOINTMENT' AND "status" IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'))
);
-- A timed appointment has an end; links are http(s) only; a zone is never blank.
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_appointment_end_check" CHECK ("type" <> 'APPOINTMENT' OR "all_day" OR "due_at" IS NULL OR "end_at" IS NOT NULL);
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_video_link_check" CHECK ("video_link" IS NULL OR "video_link" ~* '^https?://');
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_timezone_check" CHECK ("timezone" IS NULL OR length("timezone") BETWEEN 1 AND 64);

-- Calendar range queries (company calendar / one employee's calendar) and
-- conflict checks read only live appointments in a time window.
CREATE INDEX "crm_activities_appt_calendar_idx" ON "crm_activities"("company_id", "due_at") WHERE "type" = 'APPOINTMENT' AND "deleted_at" IS NULL;
CREATE INDEX "crm_activities_appt_assignee_idx" ON "crm_activities"("company_id", "assigned_to_user_id", "due_at") WHERE "type" = 'APPOINTMENT' AND "deleted_at" IS NULL;
