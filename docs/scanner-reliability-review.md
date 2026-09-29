# ScannerAgent 1.3.0 — review before rollout

Production is unchanged. Local build and filesystem publish only; no deployment, no production SQL, no laptop EXE replacement. Final continuation report: scanner-reliability-final.md.

## Changes and guarantees

- GET /api/scanner-agent/scan?readiness=1 executes the probe branch of scanner_scan_v2 on the actual scan route. It checks critical columns/types, global generated barcode uniqueness, settings, metrics/normalization dependencies and write privileges. It works in a READ ONLY transaction and creates no orders, receipts or shifts. /health remains token/liveness only; the new agent never uses it to claim readiness.
- A probe cannot prove that every future write/trigger/network request will succeed. A real scan failure still invalidates readiness in the agent and retries automatically. No external keep-alive required.
- HTTP 5xx/network/timeout/429 retain pending events. Auth/schema errors retain them and use a 60-second readiness interval. Recovery backoff is 1/2/5/10/15 seconds. HTTP 422 malformed envelopes are configuration errors, never acknowledgements.
- Valid event envelopes receive acknowledged/eventId/result/reason. Invalid barcode, inactive/missing employee, revoked picking permission and inactive shift are durable business results. Receipts are keyed by event_id and replay the same stored JSON. Legacy scanner_agent_events are recognized without recounting.
- Local encrypted receipt files are flushed before removing pending events. A crash at either boundary safely replays the same event. Receipts contain event/result/reason and stay in the original Windows profile. No automatic receipt deletion.
- scanner_shift_action is transactional. All scans and shift actions for an employee use the same advisory transaction lock; start also retains the existing one-open-shift unique index. operation_id identifies retries. New clients send the expected shift_id.
- Scan/finish ordering is explicit: scan first => included in finished totals; finish first => durable shift_inactive rejection. An offline event delivered after another client finishes its shift is not silently counted into a finished payroll snapshot; the rejection is retained locally and in DB.
- No cooldown is introduced. Existing historical cooldown columns/records are preserved but not consulted.
- Normalization trims only the explicit ECMAScript whitespace set (including TAB/CR/LF), preserves internal separators and leading zeroes, and uppercases only p followed entirely by digits. NUL, other control characters, unsupported scanner keys and malformed encodings are rejected, not silently stripped. Shared fixtures: tests/fixtures/barcodes.json.
- Queue I/O, DPAPI session persistence, HID discovery and log disk writes run off the UI thread. Scanner discovery is independent of networking. A bounded on-screen history preserves recent feedback; encrypted receipts preserve server outcomes across restarts.
- Metrics: startup_scanner_ready, startup_backend_ready, physical_to_durable, durable_to_ack for this process, replayed_ack queue age after restart, reconnect_queue_drained. Do not interpret replayed queue age as network latency. Logs include event/request IDs, attempts, endpoint/status/result/reason and queue length; no PIN/token/raw keys.

## Migration

supabase/migrations/20260928_scanner_reliability.sql

Forward-only, transaction, 5-second lock timeout. Repairs the four known audit columns if missing, adds receipt/operation tables, unique open pause index, new RPCs and the nine-argument compatibility wrapper. Does not delete or rewrite historical production rows. Prerequisite: existing normalized generated column and global UNIQUE from 20260915. It intentionally aborts on duplicate open pauses or incompatible schema. Investigate without deleting history.

Do not apply the historical 20260901 migration on its own as a repair: it installs the obsolete cooldown function. Do not rerun this forward migration manually once recorded as applied.

The exact production schema/history has not been inspected. The migration is validated against the repository's complete expected schema and repair fixtures; it is not a claim that production matches.

## Fresh database installation order

First schema.sql, then exactly:
1. 20260830_scanner_input_metadata.sql
2. 20260830_scanner_agent.sql
3. 20260830_work_shifts.sql
4. 20260830_order_assembly_intervals.sql
5. 20260831_scanner_client_time.sql
6. 20260901_too_fast_antifraud.sql
7. 20260906_employee_attendance.sql
8. 20260907_ai_reviews.sql
9. 20260910_employee_time_session_edits.sql
10. 20260914_order_search.sql
11. 20260915_global_barcode_uniqueness.sql
12. 20260928_scanner_reliability.sql

Same-date filenames are not dependency order. Do not expose a fresh database to traffic before all migrations finish. Production with migration drift requires a reviewed repair path; do not replay historical backfills blindly.

## Local automated checks

- npm run test:scanner: route tests + legacy global-barcode SQL regression + complete schema/current SQL regression (PGlite).
- npm run test:scanner:postgres: isolated PostgreSQL on a random loopback port, real parallel sessions and forced scan/finish ordering in both directions. No DATABASE_URL or production credentials are read. Windows binary dependency is optional so Linux backend installations are not blocked. The temporary cluster is stopped in finally; diagnostic files remain in the OS temp folder.
- dotnet build scanner-agent/ScannerAgent.csproj -c Release
- dotnet build scanner-agent-tests/ScannerAgent.Tests.csproj -c Release
- dotnet --roll-forward Major scanner-agent-tests/bin/Release/net8.0-windows/ScannerAgent.Tests.dll
- node tests/employee-session.cjs; node tests/order-search.cjs
- npm run typecheck

Windows tests exercise actual DPAPI and disk queue, a new child process reading pending events, the production delivery/recovery components, HTTP failures/readiness, raw input decoder, UI messages and employee switching. They do not emulate the entire Windows startup/login workflow or a physical USB scanner. Hardware unplug/replug is covered at fingerprint resolution and must also be accepted on the pilot laptop.

## Preflight and rollout (requires separate approval)

1. Take DB backup; export migration history, column types, RPC definitions/ACLs, generated expression and all barcode indexes. Run supabase/diagnostics/scanner_reliability_preflight.sql and the existing global_barcode_audit.sql. Audit duplicate open shifts/pauses and unresolved queue events. Compare Vercel deployed commit/environment to reviewed code. Never paste tokens/PINs into logs.
2. Pause scanning and drain all laptop queues, or preserve/export original profiles if draining is impossible. During DB -> backend transition the old backend still has nontransactional shift mutations, so no concurrent shift/scan traffic is allowed until the new backend is active.
3. Apply the reviewed DB migration. Check read-only readiness RPC as service_role and inspect the global unique index. Keep scanning paused if preflight/migration fails.
4. Deploy backend after DB verification. Confirm invalid token => 401; valid readiness => 200; unavailable DB/schema => not Ready; scan business rejection => structured 200, no unexpected 403/500. Observe request/RPC latency without visiting admin to warm it. Enable traffic only after this step.
5. Publish/replace EXE on ONE pilot laptop only after review. Preserve ProgramData config/token and LocalAppData queue/session/receipts. Validate numeric/P, duplicate, rapid distinct codes, offline scans + process restart + drain, scanner replug, employee switch, pause/resume/finish and timezone totals. Confirm pending and receipts on screen/disk.
6. Roll out second laptop after the pilot passes. Test the same barcode on two employees/laptops: exactly one counted, the other duplicate. Observe recovery and latency across a cold idle period.

Rollback: stop rollout/scanning if invariants fail. Preserve additive DB tables and event receipts; do not roll DB functions back to a pre-receipt writer because it can violate replay semantics. Prefer a forward fix. Old EXE may be retained for recovery with the new backend, but it does not provide the new readiness/UI guarantees. Returning to the old backend reintroduces nontransactional shifts; do not mix it with active new traffic.
