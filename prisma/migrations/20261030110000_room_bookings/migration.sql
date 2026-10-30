CREATE TABLE "RoomBooking" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "startsAt" DATETIME NOT NULL,
  "endsAt" DATETIME NOT NULL,
  "attendees" INTEGER NOT NULL,
  "needsAccessible" BOOLEAN NOT NULL DEFAULT false,
  "needsProjector" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
  "version" INTEGER NOT NULL DEFAULT 0,
  "cancelledAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "RoomBooking_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RoomBooking_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "BookingEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "bookingId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorName" TEXT NOT NULL,
  "actorRole" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "note" TEXT NOT NULL,
  "before" JSONB,
  "after" JSONB NOT NULL,
  "resultVersion" INTEGER NOT NULL,
  "requestKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BookingEvent_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "RoomBooking" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BookingEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "RoomBooking_roomId_status_startsAt_endsAt_idx" ON "RoomBooking"("roomId", "status", "startsAt", "endsAt");
CREATE INDEX "RoomBooking_ownerId_startsAt_id_idx" ON "RoomBooking"("ownerId", "startsAt", "id");
CREATE INDEX "RoomBooking_status_startsAt_id_idx" ON "RoomBooking"("status", "startsAt", "id");
CREATE INDEX "BookingEvent_bookingId_createdAt_id_idx" ON "BookingEvent"("bookingId", "createdAt", "id");
CREATE UNIQUE INDEX "BookingEvent_actorId_requestKey_key" ON "BookingEvent"("actorId", "requestKey");
