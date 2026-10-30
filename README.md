# Campusops_AI

AI-powered campus management and resource optimization platform.

Campus operations and recovery demonstration for Easwari Engineering College. The dashboard uses saved demo scenarios and submitted complaints, an approximate campus illustration, and Prisma 7 with SQLite.

## Run locally in PowerShell

This workspace has a facilities administrator login named `kavya`, linked to the existing `demo-admin` user. Use the password already provided to you; it is not recorded in these project files.

To create another login or reset an existing password, use the interactive setup command below. Existing accounts require `RESET`, which signs that user out on every device.

From `D:\Hackathon\CampusOps\campusops`:

```powershell
npm.cmd run auth:setup
```

Choose an existing user ID or `NEW`, choose a username, and review the confirmation. Type `SAVE` for a new login or `RESET` for an existing login, then enter your own password twice in the hidden prompts. Use 12–128 characters. No default password is stored in source code. Existing linked records are preserved.

```powershell
npm.cmd run dev
```

Open [http://localhost:3000](http://localhost:3000). Facilities and system admins receive the operations dashboard, with access to work orders, workforce configuration, and room bookings. Students and faculty receive the complaint workspace; faculty can also open bookings. Technicians receive their assigned work orders. Department managers receive their own booking workspace. The procurement approver module remains clearly labelled as pending. Run `auth:setup` again to create another role or reset an existing login locally.

Use [complaint submission and tracking](docs/COMPLAINTS.md) to report an issue and inspect your own requests. The existing `kavya` account can open [the complaint workspace](http://localhost:3000/complaints) without creating another login; new submissions also appear in the operations dashboard.

Use [work orders and technician workflow](docs/WORKFLOW.md) to configure technician skills and duty, triage requests, assign eligible staff, record repair progress, and review resolution before closing a request. Open [work orders](http://localhost:3000/work-orders) as `kavya`. Existing technicians start without configured skills or duty; configure their profiles before assignment. The guide includes a complete manual demonstration and explains reporter-visible history.

Use [room and event bookings](docs/BOOKINGS.md) to check room suitability and schedule conflicts, create a booking, reschedule or cancel it, and inspect its recorded changes. Open [bookings](http://localhost:3000/bookings) as `kavya` to manage the full schedule and inspect bookings potentially affected by an incident. Faculty and department managers can manage their own bookings.

Use [transportation and breakdown rescue](docs/TRANSPORT.md) from the dashboard's **Transportation** tab. The moving buses and occupied seats are a labelled demonstration simulation. Nearby-bus allocation uses distance and available-seat rules; an optional AI dispatch brief explains the plan and drafts passenger messages.

**AI features** (shift briefing, incident triage, room recovery, AI room pick, plain-language complaint intake, transport brief and OpsLens) use Claude when `ANTHROPIC_API_KEY` is set in `.env`, and fall back to built-in rules otherwise. See [AI.md](docs/AI.md). Run `npm run db:rooms` once to add demo rooms for better room recommendations.

Read [login setup, permissions, testing, and production configuration](docs/AUTH.md) and [implemented features and the full remaining roadmap](docs/PROJECT_PROGRESS.md).

## Validate

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npm.cmd run test:auth
```

Authentication, workflow, booking, and transport integration tests require a completed build and use a temporary database. The build downloads the existing Geist fonts from Google when not cached.

## Preserve local data

The app, setup scripts, and Prisma config use `DATABASE_URL`, defaulting to `file:./campusops.db`. Keep local databases, backups, and environment files private. Before reviewed schema updates, `npm.cmd run db:migrate` creates and verifies a SQLite backup, applies pending migrations, and generates the client. Do not reset or reseed the existing campus to set up login.

Production requires an HTTPS `APP_ORIGIN` and persistent SQLite storage; see the login guide before deploying.
