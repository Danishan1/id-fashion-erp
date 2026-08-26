-- HRMS gap-analysis Priority 1 item #2: wire NotificationService into Leave
-- submit/approve/reject. Adds the discriminator value needed so a Leave
-- Request notification can carry a real relatedModule/relatedRecordId pair,
-- matching the existing per-module RelatedModule pattern (CRM_FOLLOWUP,
-- JOB_WORK_ORDER, ...).
ALTER TYPE "RelatedModule" ADD VALUE IF NOT EXISTS 'LEAVE_REQUEST';
