ALTER TABLE "Incident" ADD COLUMN "resolutionNote" TEXT;
CREATE INDEX "Incident_assigneeId_status_idx" ON "Incident"("assigneeId", "status");

CREATE TABLE "TechnicianProfile" (
  "userId" TEXT NOT NULL PRIMARY KEY,
  "onDuty" BOOLEAN NOT NULL DEFAULT false,
  "maxActiveJobs" INTEGER NOT NULL DEFAULT 3,
  "availableFrom" DATETIME,
  "availableUntil" DATETIME,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "TechnicianProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "TechnicianSkill" (
  "userId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  PRIMARY KEY ("userId", "category"),
  CONSTRAINT "TechnicianSkill_userId_fkey" FOREIGN KEY ("userId") REFERENCES "TechnicianProfile" ("userId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "IncidentEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "incidentId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorName" TEXT NOT NULL,
  "actorRole" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "note" TEXT NOT NULL,
  "fromStatus" TEXT,
  "toStatus" TEXT NOT NULL,
  "fromCategory" TEXT,
  "toCategory" TEXT NOT NULL,
  "fromPriority" TEXT,
  "toPriority" TEXT NOT NULL,
  "fromAssigneeName" TEXT,
  "toAssigneeName" TEXT,
  "resultVersion" INTEGER NOT NULL,
  "requestKey" TEXT,
  "requestHash" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IncidentEvent_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "IncidentEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "IncidentEvent_actorId_requestKey_key" ON "IncidentEvent"("actorId", "requestKey");
CREATE INDEX "IncidentEvent_incidentId_createdAt_id_idx" ON "IncidentEvent"("incidentId", "createdAt", "id");
CREATE TABLE "WorkflowLock" ("id" INTEGER NOT NULL PRIMARY KEY);
INSERT INTO "WorkflowLock" ("id") VALUES (1);
