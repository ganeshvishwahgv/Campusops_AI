-- CreateTable
CREATE TABLE "BusBreakdown" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentId" TEXT NOT NULL,
    "busId" TEXT NOT NULL,
    "busName" TEXT NOT NULL,
    "routeName" TEXT NOT NULL,
    "lat" REAL NOT NULL,
    "lng" REAL NOT NULL,
    "students" INTEGER NOT NULL,
    "returnedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BusBreakdown_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "BusBreakdown_incidentId_key" ON "BusBreakdown"("incidentId");

-- CreateIndex
CREATE INDEX "BusBreakdown_busId_returnedAt_idx" ON "BusBreakdown"("busId", "returnedAt");
