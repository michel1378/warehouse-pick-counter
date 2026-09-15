# Global barcode uniqueness rollout

## Diagnosis
Baseline UNIQUE(barcode) was never removed by checked-in migrations. SQL trimmed
only edge spaces; API removed all whitespace and uppercased p; browser did not
uppercase p. This permits logical p/P duplicates across paths. Identical stored
strings cannot both pass this schema. A missing constraint alone would cause
ON CONFLICT(barcode) to fail. Inspect production indexes, RPCs, rows and deployed
backend with global_barcode_audit.sql before assigning a definitive cause.

## Deployment
Back up the warehouse project and run global_barcode_audit.sql read-only.
Apply all earlier migrations, then 20260915_global_barcode_uniqueness.sql during
a maintenance window. ACCESS EXCLUSIVE blocks scans access while the generated
column and UNIQUE are built; duration depends on table size. Lock acquisition
times out after 5 seconds. On failure all changes roll back; issue ROLLBACK if
the SQL editor leaves the transaction aborted. Collisions report group, row and
excess counts and abort without deleting or changing any rows.
Deploy the API trim validation fix too. Internal spaces are rejected, leading
zeros preserved. ScannerAgent.exe does not need an update.

The migration can be rerun. An existing STORED text column using the canonical
normalizer is reused only if every stored value matches. A different expression
or a plain column requires review, even if current rows happen to match: future
writes must also be protected. The error includes the existing definition.
No column is dropped. Compatible global indexes are reused regardless of name;
composite/partial indexes do not qualify. Deferrable arbiters require review.

For an incompatible column, preserve it and prepare a separate migration after
inspecting its definition/dependencies: add a new generated key under a new name,
audit normalized collisions, install immediate global UNIQUE and switch both
RPCs atomically. Review other consumers before any rename; keep the original
column for audit/rollback. Do not automatically rewrite stored generated values
after changing an immutable function. This migration rolls back on mismatches.

## Existing collisions
Export full scans, dependent scan_attempts/scanner_agent_events, all foreign-key
references and shift totals. Review server receipt times and original events to
select the first accepted row. Client timestamps do not prove sync order.
Prepare a separately approved deduplication migration: archive full rows and a
losing_id -> winning_id mapping, preserve losing scans as duplicate attempts,
review FK remapping and historical retry responses, recompute affected intervals,
KPI, closed shifts and earnings. Only after review remove excess counted rows
while keeping the archive and install UNIQUE in the same transaction.
This hotfix does not perform deduplication automatically.

## Verification in a disposable project
- Active shifts, valid scanner input: Artem scans new X -> counted, +1.
  Dasha scans X with another event/device/shift -> duplicate, +0 orders/earnings.
  Check one scans row and duplicate_of/reason in scan_attempts.
- Repeat numeric leading zeros, P00119280697 / p00119280697, edge whitespace.
- Queue X offline on two devices. First successful sync insertion wins,
  regardless of client time. Both HTTP 200 acknowledgements drain the queues.
- Two real PostgreSQL sessions: BEGIN and register X in A; register X for another
  employee in B before committing A. B waits for UNIQUE; commit A -> B duplicate.
  Rollback A -> B may count. Verify one scans row and both attempts.
- Retry the same event_id returns the previous response without new rows.
- Different valid barcodes at 1-second or zero intervals must both count.
  Intervals affect statistics only; the old cooldown setting is ignored.
- Check scanned_at_client, metrics, manual and inactive shift rules.

Direct INSERT/UPDATE remains protected by SQLSTATE 23505. Both application RPCs
use ON CONFLICT on the generated normalized key and atomically audit duplicates.
Other database errors are not misreported as duplicates.

SQL regression: node tests/global-barcode.cjs <path-to-installed-pglite-module>
PGlite exercises PostgreSQL SQL semantics. Use two real connections for the
concurrent transaction check above.
