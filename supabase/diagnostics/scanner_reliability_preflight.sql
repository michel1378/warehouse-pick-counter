-- READ ONLY. Export results for review; this script never repairs/deletes data.
begin read only;
select table_name,column_name,data_type,is_nullable,column_default
from information_schema.columns
where table_schema='public' and table_name in
 ('scans','scan_attempts','scanner_agent_events','work_shifts','work_shift_pauses','settings')
order by table_name,ordinal_position;
select indexname,indexdef from pg_indexes where schemaname='public' and tablename in ('scans','work_shifts','work_shift_pauses');
select a.attname,a.attgenerated,pg_get_expr(d.adbin,d.adrelid) expression
from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
where a.attrelid='public.scans'::regclass and a.attname='normalized_barcode';
select oid::regprocedure signature,proacl,pg_get_functiondef(oid) definition from pg_proc
where pronamespace='public'::regnamespace and proname in
 ('normalize_scan_barcode','register_agent_scan','register_scan','shift_order_metrics','scanner_scan_v2','scanner_shift_action');
select employee_id,count(*) open_shifts from public.work_shifts where ended_at is null group by employee_id having count(*)>1;
select shift_id,count(*) open_pauses from public.work_shift_pauses where ended_at is null group by shift_id having count(*)>1;
select w.id,w.status,count(p.id) open_pauses from public.work_shifts w
left join public.work_shift_pauses p on p.shift_id=w.id and p.ended_at is null
group by w.id,w.status having (w.status='paused' and count(p.id)<>1) or (w.status<>'paused' and count(p.id)>0);
select to_regclass('supabase_migrations.schema_migrations') migration_history_table;
-- If the preceding table exists, separately export its version/name entries.
rollback;
