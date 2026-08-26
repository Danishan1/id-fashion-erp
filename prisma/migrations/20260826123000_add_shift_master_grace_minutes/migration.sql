-- HRMS gap-analysis Priority 2 item: grace-time configuration for
-- late-coming. computeIsLate() previously compared punch-in against a
-- shift's raw startTime with zero tolerance.
ALTER TABLE "shift_masters" ADD COLUMN "grace_minutes" INTEGER NOT NULL DEFAULT 0;
