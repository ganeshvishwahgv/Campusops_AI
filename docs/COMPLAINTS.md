# Complaint submission and tracking

Students, faculty, facilities admins, and system admins can submit a campus issue and view their own saved requests at `/complaints`. Students and faculty arrive there after signing in. Administrators keep their operations dashboard and can open the complaint workspace from its navigation.

This is a structured form with a free-text description. The application does not currently interpret the description using AI, automatically categorise it, or accept complaints through chat or email.

## Try it with the existing administrator login

1. If the app is not already running, open PowerShell in `D:\Hackathon\CampusOps\campusops` and run `npm.cmd run dev`.
2. Open `http://localhost:3000` and sign in as `kavya` with the password already provided to you. This login belongs to the existing facilities administrator; it does not need to be reset to test complaints.
3. Open `http://localhost:3000/complaints`. Use the form to enter a clear title, a description of what happened, an issue type, reported urgency, and a campus location.
4. Choose a room if known. If the issue concerns a listed asset, choose its room first and then the asset. For a transport issue, you can select a bus. Use the location-detail field for useful information such as a floor or nearby landmark.
5. Submit once. The confirmation includes the saved request reference. Open that request to inspect its description, location, current status, saved dates, and submission event.
6. Refresh the page. The request should still appear in your own list. Try search, the status filter, and pagination when enough requests exist.
7. Return to the operations dashboard and refresh it. The submitted complaint should appear with the other saved incidents, including the relevant campus location pin and inspector details. Administrators can triage and assign it through `/work-orders`; follow [WORKFLOW.md](WORKFLOW.md) to demonstrate the repair lifecycle.

This manual demonstration creates a saved record in the local campus database. Use a clearly labelled demo issue if you are practising; the form does not simulate a save.

## Try a student or faculty account

Create the additional login locally without changing `kavya`:

```powershell
npm.cmd run auth:setup
```

Choose existing user `demo-faculty` to keep the faculty member's linked records, or enter `NEW` and choose `STUDENT` for a separate fictional student. Choose a username and your own password in the hidden terminal prompts. The command requests `SAVE` for a new login and `RESET` if the chosen user already has credentials. Resetting an existing login signs that user out on all devices.

Sign in with the new account in a separate private browser window. It should open the complaint workspace. Submit one issue, then confirm that this account can view its own record but cannot open the unrestricted `/api/dashboard` dataset. The existing faculty member may also see the seeded incidents they originally reported; a new student begins with an empty request list.

## Form rules

The server validates all fields, even when a caller bypasses the form.

| Field | Rule |
| --- | --- |
| Title | 5–120 characters after trimming |
| Description | 20–4,000 characters after trimming |
| Issue type | Electrical, network, equipment, plumbing, cleanliness, safety, transport, event, or other |
| Reported urgency | Low, medium, high, or critical |
| Campus location | Required; must identify an existing building/location |
| Room | Optional; must belong to the selected campus location |
| Asset | Optional; must belong to the selected room |
| Bus | Optional; must exist and can be selected only for a transport complaint |
| Additional location details | Optional; up to 200 characters |

New complaints start with status `REPORTED`. The reporter's urgency is saved separately as `reportedUrgency`; the initial operational priority is `MEDIUM`. Choosing critical urgency does not assign work, approve an action, or change resource availability. Administrators review reported urgency and set the operational category and priority during triage in `/work-orders`.

Required-field and relationship errors are returned with an explanation. Submission does not accept client-supplied reporter IDs, assignees, workflow status, or operational priority. The signed-in user becomes the reporter.

## Ownership and permissions

| Role | Submit a complaint | View complaints in `/complaints` | Operations dashboard |
| --- | --- | --- | --- |
| STUDENT | Yes | Own requests only | No |
| FACULTY | Yes | Own requests only | No |
| FACILITIES_ADMIN | Yes | Own requests only | All saved operational incidents |
| SYSTEM_ADMIN | Yes | Own requests only | All saved operational incidents |
| TECHNICIAN | Not yet | No | No |
| DEPARTMENT_MANAGER | Not yet | No | No |
| PROCUREMENT_APPROVER | Not yet | No | No |
| Signed out, expired, revoked, or inactive | No | No | No |

The complaint list and detail APIs enforce ownership on the server. Even an administrator's complaint workspace is their own list; administrators inspect all incidents through the separately protected operations dashboard and work orders. Technicians have a separate assigned-work view at `/work-orders`; this does not grant them complaint submission or access to the reporter's other requests. An unavailable or another person's request returns 404 from the complaint detail endpoint, so guessing a reference does not disclose its contents.

The form's options endpoint exposes only the reference names and IDs needed to choose a building, room, asset, or bus. It does not send other reporters' complaints, user directories, session data, or the unrestricted operations dataset to students and faculty. Own-request history includes the acting staff member's recorded name and role, human-readable assignment changes, and action notes. Notes explain progress, blockers, and resolution to the reporter. Internal actor/assignee IDs, request keys, submission fingerprints, and session data are omitted.

## Retries, limits, and saved status

- The browser supplies an idempotency key for each distinct submission attempt. If a connection fails after the server saved the record, retrying the same content with the same key returns that saved request instead of creating another one.
- Reusing a key with changed content returns 409. The form gives edited content a new submission key. A different signed-in user has a separate key namespace.
- Each reporter can create up to 20 new complaints in an hour. Requests above the limit return 429. Retrying an already saved submission does not create another complaint or consume another creation slot.
- Lists contain 20 records per page and support search and status filtering. Counts and results always apply to the signed-in reporter.
- Reporter status tracking is read only. It displays the latest saved state, dates, and action history when refreshed. Administrators and assigned technicians update work through the separately protected [work-order workflow](WORKFLOW.md).
- New submissions record a submission event. The timeline shows the latest 100 recorded events, with actor, time, note, and before/after changes; older events remain saved in the database. Existing incidents may have no earlier events because the migration does not invent historical actions.
- Reporter comments, attachment uploads, escalation, and delivered notifications remain pending.

## API reference

All endpoints require an active session and an allowed complaint role. Responses are private and not cached. Creating a complaint also requires same-origin JSON and an `Idempotency-Key` header containing a valid UUID.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/complaints/options` | Narrow campus reference choices for the form |
| `GET /api/complaints?page=1&status=ALL&q=` | Paginated list of the current reporter's requests |
| `GET /api/complaints/{id}` | One request owned by the current reporter |
| `POST /api/complaints` | Validate and save a new reported incident |

The POST JSON body contains `title`, `description`, `category`, `reportedUrgency`, `buildingId`, and optional `roomId`, `assetId`, `busId`, and `locationDetails`. Successful creation returns 201 with `{ complaint, replayed: false }`; an identical retry returns 200 with `{ complaint, replayed: true }`. Detail and submission responses include reporter-scoped history; list responses use an empty history array and the detail view loads the timeline. Other responses include 400 for invalid input, 401 for missing/invalid sessions, 403 for denied roles or origins, 404 for unavailable details, 409 for a reused key with different content, 413 for oversized bodies, and 429 for the creation limit.

## Data safety and remaining scope

Complaints use the existing `Incident` model, so saved submissions enter the established dashboard rather than a disconnected list. The additive migration introduces nullable reported-urgency and submission-deduplication fields, preserving existing users, campus records, and seeded incidents. Existing seed records can have no reported urgency or submission key. The campus illustration remains approximate and does not provide GPS or navigation.

Back up SQLite before future migrations using `npm.cmd run db:backup`. Do not reset or reseed the database to enable complaints. Keep databases and backups private.

The broader intake roadmap still includes natural-language extraction, questions for missing information, chat, and simulated email. AI categorisation, duplicate suggestions, related-incident discovery, and generated summaries are also pending. Retrying the exact same submission safely is implemented deduplication; it is not AI detection of similar complaints.

Run the project's type, lint, build, and authentication/integration checks using the commands in [README.md](../README.md). The integration test harness uses a temporary database rather than the live campus database.

## Validation recorded on 30 October 2026

These results describe the complaint-submission milestone before the work-order workflow and history were added. See [WORKFLOW.md](WORKFLOW.md#validation) for workflow validation.

- All 48 tests passed on that milestone's final code. Coverage includes authentication, all seven role policies, owner-only list/detail access, invalid and forged input, origin protection, relational validation, persisted submissions, operations dashboard visibility, simultaneous duplicate retries, pagination/search/status filtering, and the hourly creation limit.
- ESLint, TypeScript checking, and the production build passed.
- Authenticated development HTTP checks passed for the dashboard, complaint page, form options, own-request list, and dashboard API. The complaint form rendered in the page response. A development-only session-expiry prerender warning was fixed by explicitly waiting for the request before reading the current time.
- A verified online SQLite backup preceded the additive migration. Every existing user, credential, location, room, asset, bus, and incident was compared with that backup and preserved. Database integrity and foreign keys passed, and the illustration hash is unchanged.
- Tests created complaints only in the isolated test database. At that milestone, the real campus database retained its original six incidents; subsequent manual form submissions add real saved local records.
- Visual browser interaction remains unverified because the browser connector was unavailable. Use the manual flow above to check the rendered form and map interaction in your browser.
