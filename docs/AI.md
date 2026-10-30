# AI features

CampusOps uses Claude (`@anthropic-ai/sdk`) to interpret, rank and explain. Deterministic backend code still enforces permissions, capacity, availability, schedules and workflow transitions. Claude can only choose among candidates the rules have already marked eligible, and every model choice is re-validated on the server.

## Setup

```bash
# .env (never commit this file)
ANTHROPIC_API_KEY=sk-ant-...
# optional
CAMPUSOPS_AI_MODEL=claude-opus-5-5   # default
CAMPUSOPS_AI_DISABLED=true            # force the rule-based fallback
```

Without a key every feature still works: built-in rules produce the result and the UI labels it "Rule-based fallback". When Claude answers, the UI shows "Claude AI · <model>". If a Claude call fails, times out or is refused, the same rules take over automatically.

## Features

| Where | Feature | Endpoint | Who |
| --- | --- | --- | --- |
| Dashboard → Overview | Shift briefing: headline, top risks with incident links, prioritised actions | `GET /api/ai/briefing` | Facilities / system admin |
| Dashboard → incident inspector | AI triage: summary, suggested priority/category, best eligible technician, impact, next steps, likely duplicates | `GET /api/ai/triage/[id]` | Admin |
| Dashboard → Room recovery | Room out of service → checks every room for the slot, recommends the best replacement, lists affected bookings, reserves the chosen room | `GET /api/ai/room-recovery` | Admin |
| Room bookings form | "Let AI pick the best room" among rooms that pass the availability check | `GET /api/ai/rooms` | Booking roles |
| Complaints form | Describe the problem in plain words → form fields filled, follow-up questions | `POST /api/ai/complaint-draft` | Complaint roles |
| Transportation | AI dispatch brief: plan assessment, passenger/parent SMS draft, driver instructions, risks | `POST /api/ai/transport` | Admin |
| Dashboard → OpsLens | Chat over a live, read-only snapshot of incidents, rooms, bookings, technicians and buses | `POST /api/ai/lens` | Admin |

All POST routes use the existing same-origin check. AI routes are limited to 40 requests per user per minute. AI never writes to the database; reserving a room or relocating a booking goes through the normal booking service with its overlap, capacity and version checks.

## Implementation

- `src/lib/ai/client.ts` – Claude client, structured output via Zod schemas, server-side refusal fallbacks, rules fallback (`withFallback`), rate limit.
- `src/lib/ai/rooms.ts` – room recommendation and room recovery.
- `src/lib/ai/operations.ts` – complaint drafting, triage, briefing, transport brief, OpsLens.
- `src/components/ai-*.tsx`, `room-recovery.tsx`, `ops-lens.tsx`, `incident-overview.tsx` – UI.

## Demo data

`npm run db:rooms` backs up the database and adds nine fictional demo rooms (skipping any that exist) so room recommendations have real choices.
