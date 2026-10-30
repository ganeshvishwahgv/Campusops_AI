# Work orders and technician workflow

Facilities and system administrators use `/work-orders` to review complaints, set the operational category and priority, assign an eligible technician, and review completed repairs. Technicians arrive at the same page after signing in and see only their assigned orders. Students and faculty continue using `/complaints`, where their own requests include the recorded workflow history.

The existing campus dashboard remains available to administrators. Work orders use the same saved incidents as the dashboard and complaint workspace.

## Configure the workforce

Sign in as `kavya` using the existing password, open `/work-orders`, and select **Workforce**. Configure the existing technicians before trying an assignment. A missing profile is treated as off duty with no skills, so an existing technician's name or department alone does not make them eligible.

| Setting | Meaning and validation |
| --- | --- |
| Skills | One or more distinct issue categories: electrical, network, equipment, plumbing, cleanliness, safety, transport, event, or other. Assignment requires an exact match to the order's operational category. |
| On duty | Must be enabled for assignment, starting work, or resuming blocked work. |
| Maximum active jobs | An integer from 1 to 20, defaulting to 3. Cannot be set below the technician's current active workload. |
| Available from / until | Optional date and time boundaries, entered in India Standard Time (IST, UTC+05:30) in the form. Assignment, start, and resume require the current time to be within the configured window. Leaving both blank imposes no date window; the on-duty check still applies. |

Active workload counts `ASSIGNED`, `IN_PROGRESS`, and `BLOCKED` orders. Resolving an order releases its workload slot. Profile changes cannot remove skills required by that technician's active work. Profiles have version checks so one administrator cannot silently overwrite another administrator's changes.

For a fictional demonstration, configure Arun Kumar (`demo-electrician`) with **Electrical**, Meera Ravi (`demo-network`) with **Network**, and Dev Anand (`demo-av`) with **Equipment**. Enable duty and choose a capacity that accommodates each technician's current active work. These are demo choices, not verified staff skills or real shifts. No profiles, shifts, or passwords are silently populated by the migration.

The workforce form configures existing technician users. Account creation remains a local administrative operation; see [AUTH.md](AUTH.md). The workforce form does not change user roles.

## Review and assign work

The administrator queue places higher operational priorities first, then older requests. Reported urgency is shown separately: the reporter supplies it, while the administrator determines the operational priority during triage.

1. Open a reported request and review its description, location, reported urgency, and existing history.
2. Triage it with an operational category, priority, and explanatory note. This changes the status to `TRIAGED`.
3. Review technician candidates. Eligibility requires an active user with the `TECHNICIAN` role, a matching skill, current duty and availability, and sufficient capacity.
4. Choose a technician and save an assignment note. Assignment changes the status to `ASSIGNED`.

Candidates are ordered by eligibility, then active-load ratio, active job count, and name. This supports a manual decision; the app does not automatically assign a technician or use AI to make the choice. Priority determines queue order, not permission to exceed a technician's capacity.

The server repeats all eligibility checks when saving. Candidate information shown earlier in the browser is not an assignment guarantee. A transaction serializes assignment and profile changes so two simultaneous requests cannot both take the last available capacity slot.

Administrators may reassign an `ASSIGNED`, `IN_PROGRESS`, or `BLOCKED` order to an eligible technician. Reassignment returns it to `ASSIGNED`, allowing the selected technician to start work. Record the reason in the note.

## Allowed actions

Every action requires a note of 5–2,000 characters after trimming. Notes are visible to the request's reporter, so write a useful explanation of the operational change.

| Actor | Action | Allowed starting state | Result |
| --- | --- | --- | --- |
| Facilities or system admin | Triage | `REPORTED`, `NEEDS_CLARIFICATION`, `TRIAGED` | `TRIAGED`; category and priority are required |
| Facilities or system admin | Assign or reassign | `TRIAGED`, `ASSIGNED`, `IN_PROGRESS`, `BLOCKED` | `ASSIGNED`; eligible technician required |
| Assigned technician | Start | `ASSIGNED` | `IN_PROGRESS`; eligibility rechecked |
| Assigned technician | Block | `ASSIGNED`, `IN_PROGRESS` | `BLOCKED`; note explains the blocker |
| Assigned technician | Resume | `BLOCKED` | `IN_PROGRESS`; eligibility rechecked |
| Assigned technician | Resolve | `IN_PROGRESS` | `RESOLVED`; note records the resolution |
| Facilities or system admin | Close | `RESOLVED` | `CLOSED` after reviewing the outcome |
| Facilities or system admin | Reopen | `RESOLVED` | `TRIAGED`; assignment and resolution cleared for a new review |

An administrator cannot use the technician repair actions merely because they can view the order. A technician cannot change category, priority, assignee, or another technician's work. The backend validates the actor, current assignment, and transition on every command. There is no arbitrary status update endpoint, and `CLOSED` is terminal in this workflow.

Blocking records the technician's explanation. It does not reserve inventory, request procurement, create a booking, or notify another person. Room reservations use the separate [booking workspace](BOOKINGS.md); inventory, procurement, and notification operations remain roadmap work.

## History, stale edits, and retries

Each saved action records the actor's name and role at that time, timestamp, note, and before/after values for status, category, priority, and assignee. A new complaint records a submission event. Detail views return the newest 100 events; older events remain in the database. List responses omit event history to keep the queue compact. Reporter history is limited to that reporter's own request and includes the human-readable change and note; it does not disclose session data, request fingerprints, or internal actor/assignee IDs.

Existing incident records keep their saved data. The migration does not invent earlier history for seeded incidents. An empty timeline explains that no workflow events have been recorded yet; later actions begin its recorded history.

Commands include the order version that the user reviewed. If another action has already changed that order, the server returns 409 instead of overwriting it. Refresh the order, review the latest state, and retry only if the action is still appropriate. Workforce updates use the same expected-version principle.

Workflow commands also carry an idempotency key. Retrying the same command with the same key does not advance the version or append a second event. A replay returns the currently authorized order, not an old snapshot. A technician who no longer has the assignment cannot retrieve it through a replay. Reusing the key for different content returns 409. Idempotency and version checks solve different problems: a safe network retry must not repeat a saved action, and an out-of-date edit must not overwrite newer work.

## API reference

Every endpoint requires an active session. Work-order reads allow facilities admins, system admins, and assigned technicians; workforce configuration and candidate lookup require an administrator. All responses are private and not cached. Mutations require same-origin JSON; workflow commands also require a UUID `Idempotency-Key` header.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/work-orders` | Administrator queue or the technician's assigned orders |
| `GET /api/work-orders/{id}` | One authorized order with history and current version |
| `GET /api/work-orders/{id}/candidates` | Administrator-only technician eligibility and workload for the order |
| `POST /api/work-orders/{id}/actions` | Apply one allowed workflow command |
| `GET /api/workforce` | Administrator-only existing technician profiles and workload; returns `{ technicians }` |
| `PUT /api/workforce/{id}` | Configure one existing technician's skills, duty, availability, and workload limit |

Action bodies contain `action`, `expectedVersion`, and `note`. `TRIAGE` additionally requires `category` and `priority`; `ASSIGN` requires `assigneeId`. Other fields are rejected. A resolution uses the `RESOLVE` action's note as the mandatory resolution explanation.

Profile bodies contain `expectedVersion`, `skills`, `onDuty`, `maxActiveJobs`, and optional `availableFrom` / `availableUntil`. API date strings must include a timezone; null or empty values clear a boundary. When both are supplied, the end must be after the start. Profile updates cannot change a user's identity, role, or account activity.

Errors include 400 for invalid input, 401 for an invalid session, 403 for a denied role or origin, 404 for inaccessible orders, and 409 for stale versions, incompatible transitions, conflicting retries, or failed current assignment constraints. The displayed candidate list cannot replace the checks inside the save transaction.

## Manual demonstration

This sequence saves real changes to the local demo database. Use a clearly labelled demo complaint. It needs an administrator login and a separate technician login, with a reporter account if demonstrating student or faculty access.

1. Start the app with `npm.cmd run dev` and sign in as `kavya`. Keep that existing login and password; it does not need a reset.
2. In **Workforce**, configure Arun Kumar with Electrical skill, duty enabled, and enough active-job capacity. If using an availability window, make it include the current time.
3. If Arun does not yet have a login, run `npm.cmd run auth:setup` in a separate local terminal, choose existing user `demo-electrician`, choose a username and a private password, and confirm `SAVE`. If credentials already exist, reuse them; `RESET` replaces the password and revokes that user's sessions. No shared technician password is provided.
4. Submit a clearly labelled electrical complaint through `/complaints`, either as `kavya` or as a separate student/faculty account. Confirm that it starts as `REPORTED` and displays a submission event.
5. As `kavya`, open it in `/work-orders`. Triage it as Electrical, choose an operational priority, and add a note. Assign it to Arun with another note.
6. Sign in as Arun in a separate browser profile or private window. The landing page should show assigned work. Open the order and start it with a note.
7. Optionally block it with a clear explanation, then resume when the blocker is removed. Finish by resolving it with a note describing the repair and verification.
8. As the reporter, refresh the request in `/complaints`. Confirm that the status and action history show the updates. If using a student or faculty reporter, also confirm that account cannot access the administrator queue or another reporter's complaints.
9. As `kavya`, inspect the resolution note and history. Close the resolved order if satisfied. If the result is insufficient, use Reopen while it is still `RESOLVED`, then review and assign it again. A closed request cannot be reopened by this workflow.

To demonstrate a stale edit, open one order in two administrator tabs, save a permitted action in one, and attempt the old form in the other. The second action should return a conflict and require a refresh. Do not repeatedly create real submissions to test retries or rate limits; the automated harness uses an isolated database for those cases.

## Data safety and remaining scope

The workflow adds technician configuration and recorded events to the existing incident model. Use `npm.cmd run db:migrate` for reviewed pending migrations; it creates and verifies a backup before applying them. Never reset the database or rerun campus seed/customisation scripts to enable the workflow. Existing campus identities and map data must be preserved.

This provides a request lifecycle from intake through repair and administrator closure. The required hackathon recovery demonstrations still need at least two complete disruption scenarios with validated recovery and recorded outcomes. The existing six fictional incidents and this basic repair lifecycle do not complete that requirement.

The separate [booking module](BOOKINGS.md) now provides room reservations, overlap checks, alternatives, and potential affected-activity lookup. Stock and reservations, approvals and separation of duties, SLA calculations, notifications, AI interpretation, transport replacement planning, and full impact/recovery comparisons remain mandatory roadmap work. See [PROJECT_PROGRESS.md](PROJECT_PROGRESS.md). In particular, TRP Auditorium's fictional capacity is 80; the 120-person OAT rehearsal cannot be moved there without a separately validated capacity solution.

## Validation

Recorded on 30 October 2026:

- All 61 automated tests passed, with no skips. Coverage includes authentication and complaint regressions, every workflow role, assigned-only access, triage through closure, reassignment and reopening, reporter-visible history, invalid transitions and forged input, origin/body checks, technician eligibility, stale versions, idempotent retries, queue ordering, and competing assignments/profile edits at the capacity limit.
- `npm.cmd run lint`, `npm.cmd run build`, and `npm.cmd run typecheck` passed. The integration suite uses a temporary database and its own server; it does not change the live campus records.
- Comparison against the verified pre-migration backup confirmed every existing row and column in User (5), Credential (1), Building (7), Room (4), Asset (3), Bus (4), and Incident (6) remained unchanged. The campus illustration hash was unchanged. SQLite integrity passed and the foreign-key check was clean.
- Authenticated HTTP checks on the restarted local app returned 200 for the dashboard, complaint portal, work-order page, queue, workforce, and an existing incident detail. The queue returned all six existing incidents in priority order; workforce returned three technicians with profiles still unconfigured.
- Visual browser interaction remains unperformed because the browser connector is unavailable. Use the manual demonstration above to check the rendered workflow in your browser.

Use the commands in [README.md](../README.md) to repeat validation. The earlier 31-test login and 48-test complaint records describe their respective milestones.
