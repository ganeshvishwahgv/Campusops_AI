# Presentation guide

Load the demo data once: `npm run db:team` (logins), `npm run db:rooms` (rooms), `npm run db:demo` (Harrish's jobs, Abirami as transport admin, starter notifications). Each command backs up the database first and skips anything already present.

| Person | Role | Lands on |
| --- | --- | --- |
| Kavya Suresh, GaneshVishwa | Facilities / system admin | Dashboard with every module |
| Harrish | Technician (general maintenance in-charge, every job type) | My assigned work, in queue order |
| Abirami | Transport admin | Transportation: live map, breakdowns, dispatch |
| Jayavijaya | Student | Report an issue / my reports |
| Priya Raman | Faculty | My reports and room bookings |

## Notifications (bell in every header, checked every 15 seconds)

| Who | When |
| --- | --- |
| Technician | A job is assigned to them (with its queue position) or moved away |
| Reporter (student / faculty) | Their report is assigned, started, resolved, closed or reopened |
| Facilities and system admins | A new report arrives, a technician resolves or blocks a job |
| Transport admins | A bus breaks down (reported, or detected while running in the drill) and transport complaints |

## Suggested flow

1. **Jayavijaya** reports an issue → admins' bells show the new report.
2. **GaneshVishwa** opens Work orders → the new report → *Assign technician / in-charge* → Harrish (shows "this would be queue #4") → Harrish's bell shows the job.
3. **Harrish** sees the job at the end of his queue; opens his in-progress job INC-H01 → *Record resolution* → Jayavijaya's bell shows "Your reported issue is resolved" and admins are told to verify.
4. **GaneshVishwa** verifies and closes INC-H04 (already resolved by Harrish).
5. **Abirami** opens Transportation, ticks *Random breakdowns while driving* or reports one → bell alert → *Approve dispatch* for nearby buses.
