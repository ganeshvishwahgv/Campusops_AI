-- Additive: existing incidents retain their IDs, links, priority and status.
ALTER TABLE "Incident" ADD COLUMN "reportedUrgency" TEXT;
ALTER TABLE "Incident" ADD COLUMN "submissionKey" TEXT;
ALTER TABLE "Incident" ADD COLUMN "submissionHash" TEXT;

CREATE UNIQUE INDEX "Incident_reporterId_submissionKey_key" ON "Incident"("reporterId", "submissionKey");
CREATE INDEX "Incident_reporterId_createdAt_id_idx" ON "Incident"("reporterId", "createdAt", "id");
