# Room and event bookings

Open `/bookings` to reserve an existing campus room, check alternatives, reschedule an event, or cancel a reservation. This module uses the saved room capacities and facility information. It does not create rooms, change campus metadata, infer live equipment condition, or automatically move an event.

Sign in as `kavya` using the existing password to manage the full schedule. Faculty and department managers can create and manage only their own bookings. Department managers land on the booking workspace after login; faculty keep their complaint landing page and can follow the booking link. Students, technicians, and procurement approvers cannot use the booking APIs. Administrators alone can inspect incident-related affected bookings.

## Create and manage a booking

Enter an event title, purpose, number of attendees, start and end times, and any accessibility or projector requirement. The form uses India Standard Time (IST, UTC+05:30). Check availability, choose an eligible room, and save. The backend repeats the checks at save time because another booking or room condition may have changed since the search.

| Field | Validation |
| --- | --- |
| Title | 3–120 characters after trimming |
| Purpose | 10–2,000 characters after trimming |
| Attendees | An integer from 1 to 10,000, also subject to the selected room's capacity |
| Start and end | Start must be in the future and no more than 365 days away; end must be after start; duration cannot exceed seven days |
| Accessible room | When requested, the room's saved accessibility flag must be enabled |
| Projector | When requested, the room must list a projector and pass the equipment-readiness check below |

New bookings have status `CONFIRMED`. Open a saved booking to update its details, move it to another room or time, or cancel it. Updates and cancellation require a 5–2,000 character explanation. Updating a booking revalidates all room and timing constraints; saving the form does not bypass checks simply because the original booking was valid.

Cancelled bookings remain visible with their history and release the reserved time. They cannot be reopened or edited. Ended bookings are immutable. An event already underway may be cancelled; rescheduling must select a new future start. There is no destructive delete operation or change of booking owner.

## Room suitability and overlap rules

A candidate must have saved availability `AVAILABLE`, enough capacity, and the requested facilities. The projector check is conservative: the room must have `hasProjector` enabled, and every linked asset in category `EQUIPMENT` must be marked `AVAILABLE`. An unavailable equipment asset prevents a projector-required booking even when the room's projector flag is enabled. Asset names are not interpreted to guess which device is the projector. Other equipment, networking, transport, staffing, stock, and recovery requirements need separate validation and are not guaranteed by a room reservation.

Reservations occupy a half-open interval: start is included and end is excluded. A 10:00–11:00 booking and an 11:00–12:00 booking may use the same room. Any positive overlap between confirmed bookings for that room is rejected, including bookings belonging to another organiser. Cancelling a booking makes that interval available again.

Availability results show room information and reasons a room cannot be chosen. Faculty and department managers do not receive the names, purposes, owners, or references of other organisers' events through those results. When editing, the server can exclude the current booking from the overlap check only after verifying access to that confirmed booking.

Suggestions are alternatives for the entered time, attendance, and facility requirements. They do not hold a room or authorize a move. Choose a candidate and save the change; the server rechecks it inside a serialized transaction. Concurrent attempts cannot both reserve an overlapping slot in the same room. Existing room metadata is preserved rather than silently changed to make a candidate eligible.

TRP Auditorium has 80 fictional seats. An event with 120 attendees must be rejected there, even if the room is otherwise available. If no room meets the requirements, the result is no eligible room; the module does not reduce attendance or split an event automatically.

## Affected activities

Administrators can open booking impact from a work order or inspect an incident reference in the booking workspace. The lookup returns confirmed bookings that have not ended, matching the incident's room when present or its building otherwise. It returns up to 100 bookings and reports when additional results exist.

This is potential impact based on location and the saved schedule. It does not establish that every returned activity is disrupted, propagate an incident to a booking, send notifications, or certify a recovery. Incidents with no matching room or building yield no affected room bookings. A bus incident or the OAT scenario therefore does not imply an indoor alternative without a separately valid booking and recovery decision.

No incident link is permanently added to the booking by viewing impact. If an administrator changes an event after reviewing it, the booking history records the edit and explanation. Full impact relationships, comparisons, recovery execution, and the two required disruption demonstrations remain later work.

## History and safe retries

Creation, updates, and cancellation record the actor's name and role, time, explanation, and before/after booking snapshots. Detail views return the newest 100 events; older history remains in the database. Public responses omit session data, request fingerprints, and internal actor IDs.

Updates and cancellation include the booking version the user reviewed. A stale edit receives 409 and cannot overwrite a newer change. Refresh, review the latest details, and save again only if the change is still appropriate.

Every booking mutation also carries a UUID idempotency key, scoped to the actor across creation and actions. Retrying the same request with the same key returns the current authorized booking without creating a second booking, appending another event, or advancing its version again. Reusing a key with different content returns 409. After an uncertain create or update response, the form preserves the original request and provides **Retry / check this save** before allowing edits. This check works even if the start time has passed or the saved booking now occupies its room. Authorization is checked again before returning a replay.

## API reference

All endpoints require an active permitted session. All responses are private and not cached. Writes require same-origin JSON and a UUID `Idempotency-Key` header.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/bookings` | Own bookings for faculty/managers, all bookings for administrators; search, status filter, and pages of 20 ordered by start time descending |
| `POST /api/bookings` | Create a confirmed booking; returns 201, or 200 for a safe replay |
| `GET /api/bookings/{id}` | One authorized booking with its latest history |
| `POST /api/bookings/{id}/actions` | Update/reschedule or cancel an authorized booking |
| `GET /api/bookings/rooms` | Narrow room metadata for the booking form |
| `GET /api/bookings/availability` | Room candidates and eligibility reasons for the requested interval and facilities |
| `GET /api/bookings/impact?incidentId={id}` | Administrator-only potential incident impact on upcoming or ongoing confirmed bookings |

Creation fields are `title`, `purpose`, `roomId`, `startsAt`, `endsAt`, `attendees`, `needsAccessible`, and `needsProjector`. API timestamps must include a timezone. The backend sets the owner from the active session; clients cannot supply another owner.

An `UPDATE` action contains the creation fields plus `action`, `expectedVersion`, and `note`. A `CANCEL` action contains only `action`, `expectedVersion`, and `note`. Extra fields are rejected. List filters use `status=ALL`, `CONFIRMED`, or `CANCELLED`, with optional `q` and `page`. Availability uses the time and requirement fields and optional `excludeBookingId` for an authorized confirmed booking.

Responses use 400 for malformed input, 401 for an invalid session, 403 for a denied role or origin, 404 for inaccessible records, and 409 for a stale version, conflicting retry, unavailable room, unsuitable capacity/facilities, or overlap. A displayed candidate is advisory until the write transaction succeeds.

## Manual demonstration

The steps below create real local demo bookings. Use a clearly labelled event, check the current saved room state, and cancel the booking when finished. The automated suite uses an isolated database instead.

1. Start the app with `npm.cmd run dev`, sign in as `kavya`, and open `/bookings`.
2. Enter a clearly labelled demo event for a future date with 30 attendees. Choose times in IST, select any required facilities, and check availability.
3. Select an eligible room and create the booking. Open it and confirm its details and creation history.
4. Try another booking in the same room with overlapping times. It should be rejected. An adjacent interval beginning at the first booking's end is allowed if the room otherwise qualifies.
5. Open the first booking, change the room or future time, add a useful note, and save. Confirm that history contains the before/after schedule and that its former interval is released.
6. As `kavya`, open a work order with the same room or building and inspect affected bookings. Treat the list as a review aid, not proof that recovery is complete.
7. Cancel the demo booking with a reason. Confirm its history remains visible and that availability no longer treats it as a reservation.
8. If testing a faculty or department-manager login, create it locally with `npm.cmd run auth:setup`. Confirm that the account sees only its own bookings and that directly requesting another organiser's reference does not reveal it. No additional account is needed for the administrator demonstration.

For a stale-edit check, open one booking in two tabs, save an update in one, and try the older form in the other. The second save must require review of the newer state. Test the capacity safeguard by requesting 120 attendees: TRP's saved 80-seat capacity must disqualify it.

## Data safety and remaining scope

The booking migration is additive and creates no sample bookings or credentials. A verified SQLite online backup is required before applying schema changes. Use `npm.cmd run db:migrate` for reviewed migrations; do not reset the database or rerun campus seed/customisation scripts. Existing campus records and the illustration remain authoritative for this local demonstration.

Recurring bookings, room administration, stock reservations, purchase/override approval, notifications, full asset/resource coordination, transport replacement, and complete recovery planning are not implemented by this module. The suggestions and conflict checks are deterministic backend rules, not AI. See [PROJECT_PROGRESS.md](PROJECT_PROGRESS.md) for all remaining requirements.

## Validation

Verified on 30 October 2026:

- `npm.cmd run lint`, `npm.cmd run typecheck`, and `npm.cmd run build` passed.
- `npm.cmd run test:auth` passed all 75 tests with no failures or skips. The suite uses an isolated database and server. Fourteen booking tests cover lifecycle/history, every role, ownership privacy, room suitability, overlaps and adjacent intervals, competing creates/reschedules, stale edits, retries, invalid calendar/timezone input, request protection, pagination, incident impact, and expired/revoked access.
- All six migrations are applied, and Prisma reports no schema difference. Comparison with the verified pre-migration backup confirmed existing user, credential, campus, incident, workforce, and workflow records were unchanged. SQLite integrity and foreign-key checks passed, and the campus illustration hash was unchanged. No sample bookings were added to the working database.
- Authenticated HTTP checks against the restarted local app returned 200 for the dashboard, complaint portal, work orders, bookings, room metadata, availability, and incident impact. The 120-attendee check disqualified TRP with its saved 80-seat capacity. The temporary smoke-test session was logged out successfully.
- Visual browser interaction remains unverified: the browser access host is unavailable. Use the manual demonstration above to check the rendered form and controls.

The earlier 61-test workflow result describes the previous milestone. See [README.md](../README.md) for repeatable validation commands.
