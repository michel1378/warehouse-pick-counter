-- scans.barcode already has an index from its UNIQUE constraint.
-- Add an exact-barcode lookup index for the existing attempt history.
-- No data or scan registration functions are changed.
create index if not exists scan_attempts_barcode_attempted_at_id_idx
  on public.scan_attempts (barcode, attempted_at desc, id desc);
