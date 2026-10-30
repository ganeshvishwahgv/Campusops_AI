-- Additive only: existing campus records, credentials and sessions are preserved.
CREATE TABLE "LoginThrottle" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "attempts" INTEGER NOT NULL,
    "expiresAt" DATETIME NOT NULL
);

CREATE INDEX "LoginThrottle_expiresAt_idx" ON "LoginThrottle"("expiresAt");
