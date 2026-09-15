-- Read-only: run BEFORE migration, including when migration aborted.
select indexname,indexdef from pg_indexes where schemaname='public' and tablename='scans';
select conname,pg_get_constraintdef(oid) from pg_constraint where conrelid='public.scans'::regclass;
select pg_get_functiondef(oid) from pg_proc
where pronamespace='public'::regnamespace and proname in ('register_scan','register_agent_scan');

with trimmed as (
  select s.*,btrim(barcode,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') value
  from public.scans s
), grouped as (
  select case when value ~ '^p[0-9]+$' then 'P'||substr(value,2) else value end normalized_barcode,
    count(*) row_count,
    jsonb_agg(to_jsonb(trimmed)-'value' order by coalesce(received_at_server,scanned_at),id) rows
  from trimmed group by 1 having count(*)>1
)
select *,sum(row_count) over() total_rows,sum(row_count-1) over() excess_rows,
  count(*) over() duplicate_groups from grouped order by row_count desc,normalized_barcode;
