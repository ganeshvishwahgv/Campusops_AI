# CampusOps login and access

CampusOps now requires a username and password before showing saved campus operations. There is no public registration endpoint and no built-in password. Initial passwords are chosen locally, in a hidden terminal prompt.

This workspace now has an explicitly requested local login named `kavya` for the existing facilities administrator `demo-admin`. Its generated password was supplied directly to the user and is not stored in source files or this guide. Use that existing login to open the dashboard. The setup command below can provision additional logins or reset passwords.

## Create your first demo login

Open PowerShell in `D:\Hackathon\CampusOps\campusops`. Run:

```powershell
npm.cmd run auth:setup
```

1. Read the table of existing users. Enter `demo-admin` to use the existing facilities administrator, Kavya Suresh. This preserves her user ID and all linked campus records.
2. Choose a username, for example `kavya`. Usernames are case insensitive, stored in lowercase, and accept 3–64 letters, numbers, dots, underscores, or hyphens, beginning with a letter or number.
3. Review the displayed name, role, and username. Type `SAVE` for a new login. If that user already has a login (including `demo-admin` in this workspace), the command requires `RESET`; this replaces the password and revokes that user's current sessions.
4. Choose your own password of 12–128 characters and enter it twice. Nothing appears while you type; this is intentional. Spaces are allowed. Do not put the password in chat, a command, a file, or source code.
5. Start the app:

```powershell
npm.cmd run dev
```

Open `http://localhost:3000`. Enter your chosen username and password. The existing operations dashboard opens for `FACILITIES_ADMIN` and `SYSTEM_ADMIN`.

The setup command needs a normal interactive terminal. It intentionally refuses piped input and command-line arguments. Ctrl+C cancels before saving. Passwords are hashed before the database transaction; a failed or cancelled setup saves no partial login.

To create another role, run `npm.cmd run auth:setup` again and enter `NEW`. Choose a fictional display name and one of the seven listed roles. The command creates a unique demo user and local placeholder email under `campus.example`. To add a login to an existing faculty member or technician, enter their existing ID instead. Setup never changes an existing user's role or activates an inactive user.

To reset a password, choose the existing user's ID again. Review the account and type `RESET` when asked. A successful reset revokes all that user's sessions. If their login is currently throttled, wait for the attempt window to expire before signing in.

## Current permission matrix

All restrictions are checked on the server. Changing browser JavaScript or directly requesting the API does not grant extra access.

| Role | Signed-in landing page | `GET /api/dashboard` | Complaint APIs | Work orders and workforce | Room bookings |
| --- | --- | --- | --- | --- | --- |
| STUDENT | Complaint submission and own-request tracking | 403 | Submit; own requests and history; narrow form options | 403 | 403 |
| FACULTY | Complaint submission and own-request tracking | 403 | Submit; own requests and history; narrow form options | 403 | Create and manage own bookings; check room availability |
| TECHNICIAN | Assigned work orders | 403 | 403 | Own assigned orders; allowed repair actions; no workforce administration | 403 |
| DEPARTMENT_MANAGER | Own room and event bookings | 403 | 403 | 403 | Create and manage own bookings; check room availability |
| FACILITIES_ADMIN | Existing campus operations dashboard | Allowed, read only | Submit; own requests and history; narrow form options | All orders; triage, assignment, resolution review; technician profile configuration | Manage all bookings; room availability and incident impact |
| PROCUREMENT_APPROVER | Procurement workspace; module labelled pending | 403 | 403 | 403 | 403 |
| SYSTEM_ADMIN | Existing campus operations dashboard | Allowed, read only | Submit; own requests and history; narrow form options | All orders; triage, assignment, resolution review; technician profile configuration | Manage all bookings; room availability and incident impact |
| Signed out, expired, revoked, or inactive | Redirect to login | 401 | 401 | 401 | 401 |

`GET /api/auth/me` returns only the signed-in user's basic profile; an invalid session receives 401. Students and faculty can submit and track their own complaints but cannot retrieve the unrestricted operations dataset. The complaint workspace is owner-scoped for administrators too. Administrators inspect all incidents through the separately protected dashboard and `/work-orders`. The dashboard retains map, search, filters, refresh, and transport inspection.

Technicians can retrieve and act on only orders currently assigned to them. They cannot triage, assign work, configure workforce profiles, or close requests. A guessed reference does not grant access to another technician's work. See [COMPLAINTS.md](COMPLAINTS.md) for reporter access and [WORKFLOW.md](WORKFLOW.md) for action permissions and assignment checks.

Faculty and department managers can create and manage only their own room bookings. Department membership does not grant access to another person's event. Room availability checks disclose suitability and conflicts without exposing another organiser's event details. Only facilities and system administrators can inspect the full schedule and incident-related affected bookings. See [BOOKINGS.md](BOOKINGS.md). Procurement approvers retain a clearly labelled pending landing page.

There are no public user administration or role-changing routes. Local access to the database and setup command is an administrative capability: keep the workspace private.

## How authentication works

- Each password uses an independent random salt and the Node.js scrypt password hashing function, with N=32768, r=8, p=3 and a 64-byte derived key. This follows the 32 MiB configuration in the [OWASP password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). Only the encoded salt, hashing parameters, and derived hash are saved. Passwords are not logged or stored in plaintext.
- Successful login creates a cryptographically random session token. The database stores only its SHA-256 hash, linked to a user and absolute expiry.
- Sessions last eight hours. The cookie is HTTP-only, uses SameSite=Lax and Path=/, and expires with the session. Production cookies are Secure. Closing a browser does not necessarily end a session; use **Sign out**.
- Every protected server page and API request resolves the session from the database, checks expiration and current user activity, and checks the current role. Role and active-status changes therefore apply to existing sessions.
- Login, logout, complaint creation, and operational mutations require same-origin JSON requests. Origin checks protect these actions against cross-site requests, including login CSRF, following the [OWASP CSRF prevention guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html). Missing or mismatched origins are rejected; these routes do not enable cross-origin access.
- Invalid usernames, wrong passwords, and inactive users receive the same invalid-credential message. A nonexistent username still performs password-hash work.
- Persistent database counters limit each normalized username to five attempts in fifteen minutes and the whole application to one hundred attempts per minute. A successful login resets the username counter; successful attempts still count toward the global limit. The global limit also bounds attempts with rotating usernames. The app does not trust arbitrary forwarded IP headers. Limits can temporarily affect legitimate users; use an edge limiter with a correctly configured trusted proxy for larger deployments.
- Auth, dashboard, complaint, work-order, and booking API responses are not publicly cached. The browser checks access again when returning to the workspace; logout uses a full navigation so client state is discarded.

## Production configuration

For an HTTPS deployment, configure the exact public origin in the server environment, for example:

```text
APP_ORIGIN=https://campusops.example.edu
DATABASE_URL=file:./campusops.db
```

`APP_ORIGIN` is an origin only, with no path. Use your actual hostname and port. Production requires an explicitly configured origin; HTTPS is required except for loopback development smoke tests. Keep secrets and `.env` files out of Git. Do not set an HTTP origin for an externally accessible production deployment. Serve the application and login over HTTPS, with persistent storage for the SQLite database and private backups.

The default database is `campusops.db` in the project root. The CLI, Prisma config, and server use `DATABASE_URL` when configured. SQLite and these throttling counters are suitable for this single-database hackathon app; separate instances must share the same authoritative database or use a shared session/rate-limit store. Password recovery, MFA, automated account invitations, and a hosted user-management interface remain future work.

In development, both `http://localhost:3000` and `http://127.0.0.1:3000` work. Each is a separate browser origin: sign in using the address you intend to keep using. Without `APP_ORIGIN`, development accepts only loopback hosts on the server's port. To use a LAN address or custom development hostname, configure its exact `APP_ORIGIN` and restart the server. Production always uses the explicitly configured origin and never trusts forwarded-host headers for this check.

## Database safety and future migrations

The existing Credential and Session migration was inspected rather than rerun or replaced. A new additive migration supplies persistent login throttling. Existing campus rows and the map image are preserved.

Before future schema changes, run:

```powershell
npm.cmd run db:backup
npx.cmd prisma migrate status --config prisma7.config.ts
```

The backup uses SQLite's online backup API, captures committed WAL data, and runs `PRAGMA integrity_check` against the snapshot. It writes a unique file in `backups`. Keep backups private: they can contain credential hashes and session records.

To apply reviewed pending migrations and regenerate the client:

```powershell
npm.cmd run db:migrate
```

This convenience command runs a verified backup first, applies pending migrations with `prisma migrate deploy --config prisma7.config.ts`, and regenerates the Prisma client. It stops if any step fails.

Do not reset the database or rerun seed/customisation scripts to install login. SQLite files, sidecars, backups, generated client files, environment files, and test artifacts are ignored by Git. The supplied workspace was not a Git repository when inspected; `.gitignore` protects future commits but does not remove files already tracked in another repository.

## Try the access checks yourself

1. Open a private browser window at `http://localhost:3000`. It should show login. Open `/api/dashboard` in that window: it should return 401 with no campus records.
2. Enter a wrong password once, then the correct password. The first attempt should fail generically; the second should open your permitted landing page.
3. As `demo-admin`, check map pins, the incident inspector, search, zoom, refresh, and Transportation. The six fictional incidents remain available.
4. Sign out, then open `/api/dashboard` again. It should return 401.
5. Create a student or faculty login using the local setup command. After signing in, the complaint workspace should appear. Submit and inspect an own request; directly opening `/api/dashboard` should still return 403 without the administrative dataset. Another reporter's complaint reference must not grant access to their details.
6. Reset an account's password locally while it is signed in. Its previous session should stop working on the next server request. Automated tests cover expired and inactive-user sessions without altering the real campus data.
7. Follow [the work-order demonstration](WORKFLOW.md#manual-demonstration). Confirm that the technician can see only assigned work and the reporter can see only their own request's history. A student or faculty request to a work-order or workforce endpoint must return 403.
8. Follow [the booking demonstration](BOOKINGS.md#manual-demonstration). Faculty and department managers must see only their own bookings; only facilities and system admins may inspect the full schedule or incident impact. A student, technician, or procurement approver request to a booking endpoint must return 403.

Five failed attempts for the same username can trigger a fifteen-minute wait. Do not repeatedly guess during a presentation; choose and test your passwords locally beforehand.

For automated validation, run these commands from the project folder:

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npm.cmd run test:auth
```

Build before running the authentication integration tests. The tests use their own temporary database and server, exercise direct API access for all roles, and do not create credentials in `campusops.db`.

## Login validation recorded on 30 October 2026

These results describe the completed login milestone before the complaint module was added. Complaint validation is reported separately in the implementation handoff.

- TypeScript checking, ESLint, and the production build passed on the final code.
- All 31 automated tests passed: all seven roles, direct API bypass attempts, wrong and inactive credentials, CSRF/origin checks, cookie attributes, stored token hashes, rotation/logout, expiration, role changes, persistent sessions and throttling across server restarts, concurrent attempt limits, the global limit, piped-password refusal, and twelve origin-policy regression cases.
- Real-workspace HTTP checks confirmed a signed-out server redirect to `/login`, a rendered login form, and a 401/no-store dashboard API response. With Cache Components, the redirect may be streamed in an HTTP 200 HTML response; private data is never rendered before the check.
- A verified online backup was created before the additive migration. All rows in the eight existing tables matched the backup before the requested login was provisioned. Follow-up checks confirmed all six campus-data tables (users, buildings, rooms, assets, buses, and incidents) still match, database integrity passes, and the campus illustration's SHA-256 hash is unchanged. The newly requested credential is the intended addition.
- Development HTTP checks confirmed that both localhost and 127.0.0.1 pass same-origin validation, while a request using the other address as its Origin is rejected. Production continues to require its exact configured origin.
- The initial implementation created no real credentials. A subsequent explicit user request provisioned the existing `demo-admin` as `kavya`, with a newly generated random password stored only as a salted hash; login and dashboard API access were verified. Interactive terminal prompts were type-checked and reviewed but were not exercised automatically.
- Visual browser interaction could not be completed: the browser connector was unavailable, and Windows Computer Use stopped because it could not confidently determine Chrome's current URL. The existing map/search/zoom/transport UI was preserved in source; use the manual checks above after creating your login.
