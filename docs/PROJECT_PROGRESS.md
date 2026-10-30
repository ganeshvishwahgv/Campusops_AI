# CampusOps project progress

Updated: 30 October 2026. This records implemented behavior and preserves the remaining hackathon scope. Placeholder views are not complete modules, saved summaries are not AI, and the campus illustration is not live GPS or a navigation map.

## Implemented

- Next.js 16 / React 19 dashboard with the established white/ivory, navy, and amber appearance and original `public/campus-map.png` illustration.
- Prisma 7 / SQLite campus foundation with linked users, buildings, rooms, assets, buses, and incidents.
- Database-backed operations API and dashboard, saved incident details, map pins and location filtering, incident inspector, search, zoom, refresh, and transportation inspection.
- Username/password login, salted password hashing, persistent hashed-token sessions, eight-hour expiry, logout, inactive-user rejection, generic credential failures, persistent attempt throttling, and same-origin protection on authentication writes.
- Server-side page protection, API authentication, and backend role checks. Only facilities and system admins receive the full operations dataset. Students and faculty receive their own complaint workspace; technicians receive assigned work orders; department managers receive their own booking workspace. Procurement approvers retain a clearly labelled pending landing page.
- A local interactive command to create or reset credentials without a shared password or public privileged registration; session revocation on password reset.
- Safe online SQLite backup command, private-data ignore rules, and an explicit role-permission matrix in [AUTH.md](AUTH.md).
- An explicitly requested local login for the existing facilities administrator (`kavya`, linked to `demo-admin`); no password or session token is included in source files.
- The login milestone was verified with 31 passing automated tests, TypeScript checking, lint, and a production build. Development supports both localhost and 127.0.0.1 with strict origin checks. Full visual interaction checks remain unverified because browser automation could not confidently identify the current browser URL.
- Complaint submission and own-request tracking for students, faculty, facilities admins, and system admins, with a structured form, free-text description, validated campus location/room/asset/bus selections, saved references, status/date inspection, search, status filtering, and pagination.
- New complaints enter the existing operations dashboard as `REPORTED` incidents. Reported urgency is recorded separately from the initial `MEDIUM` operational priority. Ownership checks, same-origin protection, per-reporter creation limits, and idempotent retries are enforced on the backend. See [COMPLAINTS.md](COMPLAINTS.md).
- Administrator work-order queue with operational triage, priority ordering, manual assignment and reassignment, resolution review, closure, and reopening of resolved work. Technicians see only their assigned orders and can start, block, resume, and resolve them through validated transitions.
- Administrator configuration of existing technician skills, duty, optional availability windows, and active-job limits. Assignment rechecks active technician role, exact skill, duty/window, and workload on the server. Start and resume also recheck eligibility. Serialized capacity checks prevent competing assignments from taking the same last slot.
- Version checks and idempotent workflow commands, recorded actor/change/note history, and reporter-visible history on own requests. Existing records receive no invented past history, and missing workforce profiles remain off duty without skills until explicitly configured. See [WORKFLOW.md](WORKFLOW.md) for permissions, transitions, and the manual demonstration.
- Room/event booking creation, updates/rescheduling, cancellation, and recorded change history. Faculty and department managers manage their own bookings; facilities and system admins manage the full schedule. Server checks enforce saved room availability, capacity, accessibility, requested projector readiness, and half-open time intervals with no overlapping confirmed reservations.
- Room alternatives with eligibility reasons, authorized exclusion of the current booking during edits, serialized overlap checks, stale-version conflicts, and idempotent booking writes. Administrator incident impact identifies potentially affected upcoming/ongoing bookings by room or building; it does not execute or certify recovery. See [BOOKINGS.md](BOOKINGS.md).

## Preserved campus data

A read-only inspection before login implementation found 7 locations, 4 rooms, 3 assets, 4 buses, 5 users, and 6 incidents. Credential and Session tables existed with no records. These counts describe the inspected snapshot; locally creating demo users and submitting complaints will increase the relevant counts. New complaints use the existing incident model, with additive nullable fields for reported urgency and retry deduplication.

| Stable location ID | Campus location |
| --- | --- |
| A | Main Block |
| B | Academic Block |
| C | Civil Block; contains TRP Auditorium |
| D | Admin Block |
| L | Mechanical Block |
| T | Bus Stops |
| OAT | Open Air Theatre |

Building `mapX` / `mapY` values are percentage coordinates for HTML pins on an approximate illustration. Campus names are real; the seeded operational records, capacities, and scenarios are fictional. Submitted complaints contain the information entered by their reporters and are saved records, not simulated submissions.

The six saved scenarios are electrical failure before a Main Block exam, Academic Block Wi-Fi outage, bus breakdown affecting event participants, Academic Block projector failure, rain interrupting an OAT rehearsal, and microphone failure before a TRP Auditorium inauguration. These are saved incident examples, not completed recovery workflows.

TRP Auditorium has 80 fictional seats; the OAT rehearsal involves 120 people. Moving all 120 into TRP is invalid unless a separately validated capacity solution is supplied. Future recovery planning must check capacity, bookings, accessibility, equipment, stock, and permissions before execution.

## Remaining required scope

| Area | Existing foundation | Still required |
| --- | --- | --- |
| Complaint intake | Structured complaint form, free-text description, validated reference choices, own-request tracking, saved incidents | Natural-language interpretation/extraction of issue type, location, urgency, and assets; follow-up questions for missing details; chat and simulated email intake |
| AI interpretation | Optional saved summary field | Actual categorisation, duplicate suggestions, related incidents, and generated summaries with clear provenance |
| Campus records | Users, buildings, rooms, assets, buses; configurable technician skills, duty, availability windows, and job limits | Recurring staff shifts, maintenance history, complete management interfaces |
| Work assignment | Manual assignment/reassignment with deterministic skill, workload, duty, and availability checks; queue ordered by priority | Broader scheduling/resource coordination and any assignment automation; no AI assignment is implemented |
| Rooms and events | Booking lifecycle and history; overlap prevention; saved capacity, availability, accessibility and projector checks; room alternatives; potential affected activities by incident location | Recurring bookings, room administration, full resource/stock checks, validated recovery moves and outcome verification |
| Inventory | Asset records | Stock and part counts, reservations, availability checks, blocked work when parts are unavailable |
| Approvals | Role names only | Purchase, costly-repair, and override requests; separation of duties; no self-approval where required; revalidate constraints before executing approvals |
| SLA and notifications | Deadline/timestamp fields | Deadline calculation, escalation, targeted notifications and delivery handling |
| Analytics | Open and critical incident counts | SLA compliance, utilisation, shortages, recurring-incident analysis |
| Workflow reliability | Validated complaint-to-closure and booking actions; version conflicts; serialized assignment/capacity and booking overlap checks; idempotent submissions/commands; action history | Apply equivalent concurrency and repeated-command safeguards to future stock, approvals, and recovery execution |
| External integration | None | At least one explicitly simulated integration with a complete, demonstrable flow |
| Transportation | Buses, capacity, availability, incident inspection | Routes, stops, drivers, schedules, validated replacement availability/capacity checks |
| Impact and recovery | Incident pins and inspection; administrator lookup of potentially affected upcoming/ongoing bookings by incident room or building | Full impact relationships, recovery-plan comparison, what-if simulation, recovery decision history and outcome verification |
| End-to-end demonstrations | Six incident examples and a basic request lifecycle through technician repair and admin closure | At least two complete disruption scenarios from intake to validated recovery and recorded outcome |
| Role workspaces | Authentication; student/faculty complaint submission and own-request history; admin dashboard, own-request portal, work orders, workforce, and booking management; technician assigned work; faculty/department-manager own bookings | Broader department management, procurement approval module, remaining scoped operational APIs and actions |

AI should interpret and explain. Deterministic backend code must enforce permissions, capacity, scheduling, stock, state transitions, and approval rules. No UI-only controls may substitute for those checks.

Login, structured complaint submission, the basic review-to-resolution workflow, and the room/event booking lifecycle are implemented. The roadmap above remains mandatory later work and must not be represented as implemented merely because a screen, role, database column, or fictional incident already exists. A repair lifecycle or room suggestion does not by itself complete the two required disruption recovery demonstrations. Submission retry deduplication and booking alternatives are deterministic backend checks and must not be presented as AI.

The workflow milestone passed all 61 automated tests with no skips, lint, TypeScript checking, and the production build. Tests cover the complete request lifecycle, role and ownership restrictions, technician eligibility, invalid transitions, stale edits, concurrent capacity checks, and safe command retries, alongside the existing login and complaint checks. The suite uses an isolated database. Comparison with the verified pre-migration backup confirmed all existing user, credential, location, room, asset, bus, and incident data remained unchanged; SQLite integrity and foreign keys passed, and the illustration hash was unchanged.

Authenticated HTTP checks on the restarted local app passed for the dashboard, complaint portal, work-order page, queue, workforce, and an existing incident detail. Visual browser interaction remains unperformed because the browser connector is unavailable. See [WORKFLOW.md](WORKFLOW.md#validation) for the current results and manual demonstration. The earlier 48-test complaint results and HTTP checks remain documented as a separate historical milestone in [COMPLAINTS.md](COMPLAINTS.md).

The booking milestone passed all 75 automated tests with no skips, lint, TypeScript checking, and the production build. Its 14 additional tests cover booking lifecycle and history, own/admin permissions, room requirements, concurrent reservations/reschedules, overlap boundaries, cancellation, safe retries, stale edits, validation, and incident impact. All six migrations are applied with no schema drift. Existing records and the campus illustration were unchanged against the verified pre-migration backup; database integrity and foreign keys passed. No sample bookings were created in the working database.

Authenticated HTTP checks passed for the new booking page and APIs, alongside the existing pages. A 120-attendee availability check correctly rejected TRP's 80-seat capacity. Visual interaction remains unverified because the browser access host is unavailable. See [BOOKINGS.md](BOOKINGS.md#validation) for current results and the manual demonstration.
