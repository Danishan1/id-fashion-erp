-- Attendance Correction Request notifications carry a real drill-down
-- discriminator, matching the existing per-module RelatedModule pattern
-- (LEAVE_REQUEST, CRM_FOLLOWUP, JOB_WORK_ORDER, ...).
ALTER TYPE "RelatedModule" ADD VALUE IF NOT EXISTS 'ATTENDANCE_CORRECTION';
