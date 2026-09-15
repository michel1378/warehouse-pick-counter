-- Apply after all earlier migrations. No rows are deleted or rewritten.
-- A short maintenance window is required: the lock covers audit + constraint + RPCs.
begin;
set local lock_timeout = '5s';
lock table public.scans in access exclusive mode;

-- Match ECMAScript trim(); preserve internal whitespace and numeric leading zeros.
-- Only the supported Yandex p + digits prefix is case-insensitive.
create or replace function public.normalize_scan_barcode(p_barcode text)
returns text language sql immutable strict parallel safe set search_path=public as $$
  select case when value ~ '^p[0-9]+$' then 'P' || substr(value,2) else value end
  from (select btrim(p_barcode, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') as value) n
$$;

do $$
declare
  v_groups bigint;
  v_rows bigint;
  v_excess bigint;
begin
  select count(*),coalesce(sum(n),0),coalesce(sum(n-1),0)
    into v_groups,v_rows,v_excess
  from (select count(*) n from public.scans
        group by public.normalize_scan_barcode(barcode) having count(*)>1) duplicates;
  if v_groups>0 then
    raise exception 'GLOBAL_BARCODE_DUPLICATES: % groups, % rows, % excess rows',v_groups,v_rows,v_excess
      using hint='No data changed. Run supabase/diagnostics/global_barcode_audit.sql; review and archive collisions and reconcile references/KPI before approving a separate deduplication migration.';
  end if;
end $$;

-- Validate both the stored values and how FUTURE values are generated.
-- Matching current rows alone is insufficient (especially for an empty table).
-- Unknown expressions fail closed; no existing column is dropped or rewritten.
do $$
declare
  v_column record;
  v_expression text;
  v_mismatches bigint;
  v_constraint_name text := 'scans_normalized_barcode_key';
  v_suffix integer := 0;
begin
  select a.attnum,a.atttypid,a.attgenerated,a.attcollation,
         pg_get_expr(d.adbin,d.adrelid) as expression
    into v_column
  from pg_attribute a
  left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where a.attrelid='public.scans'::regclass
    and a.attname='normalized_barcode' and not a.attisdropped;

  if not found then
    alter table public.scans add column normalized_barcode text
      generated always as (public.normalize_scan_barcode(barcode)) stored;
  else
    v_expression := v_column.expression;
    if v_column.atttypid <> 'text'::regtype
       or v_column.attgenerated <> 's'
       or coalesce(v_expression,'') not in (
         'normalize_scan_barcode(barcode)', 'public.normalize_scan_barcode(barcode)'
       ) then
      raise exception 'NORMALIZED_BARCODE_DEFINITION_REQUIRES_REVIEW'
        using detail=format('Existing type=%s, generated=%s, expression=%s',
          format_type(v_column.atttypid,null),v_column.attgenerated,v_expression),
        hint='No data changed. Keep this column. Export its definition and inspect its function/trigger dependencies. An alternative expression may be equivalent, but is not automatically trusted. Review a separate migration with a new generated key, audit collisions and switch RPCs/indexes transactionally; preserve the original column.';
    end if;
  end if;

  select count(*) into v_mismatches from public.scans
  where normalized_barcode is distinct from public.normalize_scan_barcode(barcode);
  if v_mismatches > 0 then
    raise exception 'NORMALIZED_BARCODE_VALUES_MISMATCH: % rows',v_mismatches
      using hint='No data changed. Stored generated values may be stale after a function change. Preserve the column and review a separate migration with a new generated key; do not overwrite historical data automatically.';
  end if;

  select attnum,attcollation into v_column from pg_attribute
  where attrelid='public.scans'::regclass and attname='normalized_barcode' and not attisdropped;

  -- ON CONFLICT cannot use a deferrable unique arbiter, even if another exists.
  if exists(select 1 from pg_index i
    where i.indrelid='public.scans'::regclass and i.indisunique
      and i.indnkeyatts=1 and i.indkey[0]=v_column.attnum
      and i.indpred is null and i.indexprs is null and not i.indimmediate
  ) then
    raise exception 'NORMALIZED_BARCODE_DEFERRABLE_UNIQUE_REQUIRES_REVIEW'
      using hint='No data changed. Review replacing the deferrable constraint with an immediate global UNIQUE in a separate transaction; ON CONFLICT requires an immediate arbiter.';
  end if;

  -- Reuse a valid, immediate, non-partial global index, regardless of its name.
  -- A composite (employee/shift, barcode) index does NOT satisfy this check.
  if not exists(select 1 from pg_index i
    join pg_class c on c.oid=i.indexrelid
    join pg_am am on am.oid=c.relam
    join pg_opclass op on op.oid=i.indclass[0]
    where i.indrelid='public.scans'::regclass and i.indisunique
      and i.indisvalid and i.indisready and i.indimmediate
      and i.indnkeyatts=1 and i.indkey[0]=v_column.attnum
      and i.indpred is null and i.indexprs is null
      and i.indcollation[0]=v_column.attcollation
      and am.amname='btree' and op.opcname='text_ops'
      and op.opcnamespace='pg_catalog'::regnamespace
  ) then
    -- Preserve any unrelated index/constraint that already owns the usual name.
    while exists(select 1 from pg_class
                 where relnamespace='public'::regnamespace and relname=v_constraint_name)
       or exists(select 1 from pg_constraint
                 where conrelid='public.scans'::regclass and conname=v_constraint_name)
    loop
      v_suffix := v_suffix+1;
      v_constraint_name := 'scans_normalized_barcode_key_' || v_suffix;
    end loop;
    execute format('alter table public.scans add constraint %I unique (normalized_barcode)',v_constraint_name);
  end if;
end $$;

create or replace function public.register_scan(
  p_barcode text,
  p_employee_id uuid,
  p_duration_ms integer,
  p_was_paste boolean default false
)
returns table (
  success boolean,
  scan_id uuid,
  scanned_at timestamptz,
  original_employee_name text,
  input_type text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_barcode text := public.normalize_scan_barcode(p_barcode);
  v_scan scans%rowtype;
begin
  if char_length(v_barcode) < 1 or char_length(v_barcode) > 512 then
    raise exception 'INVALID_BARCODE';
  end if;

  if not exists (select 1 from employees where id = p_employee_id and active) then
    raise exception 'EMPLOYEE_INACTIVE';
  end if;

  if p_was_paste
     or p_duration_ms is null
     or p_duration_ms < 0
     or p_duration_ms > 1500
     or char_length(v_barcode) < 8
     or (p_duration_ms::numeric / greatest(char_length(v_barcode) - 1, 1)) > 50 then
    insert into scan_attempts (barcode, employee_id, success, input_type, duration_ms, duplicate_of, reason)
    values (v_barcode, p_employee_id, false, 'manual', greatest(coalesce(p_duration_ms, 0), 0), null, 'manual');
    return query select false, null::uuid, null::timestamptz, null::text, 'manual'::text;
    return;
  end if;

  insert into scans (barcode, employee_id)
  values (v_barcode, p_employee_id)
  on conflict (normalized_barcode) do nothing
  returning * into v_scan;

  if v_scan.id is not null then
    insert into scan_attempts (barcode, employee_id, success, input_type, duration_ms, duplicate_of, reason)
    values (v_barcode, p_employee_id, true, 'scanner', p_duration_ms, null, 'counted');
    return query select true, v_scan.id, v_scan.scanned_at, null::text, 'scanner'::text;
  else
    select s.* into v_scan from scans s where s.normalized_barcode = v_barcode;
    insert into scan_attempts (barcode, employee_id, success, input_type, duration_ms, duplicate_of, reason)
    values (v_barcode, p_employee_id, false, 'scanner', p_duration_ms, v_scan.id, 'duplicate');
    return query
      select false, v_scan.id, v_scan.scanned_at, e.name, 'scanner'::text
      from employees e where e.id = v_scan.employee_id;
  end if;
end;
$$;

revoke all on function public.register_scan(text, uuid, integer, boolean)
  from public, anon, authenticated;

create or replace function public.register_agent_scan(
  p_event_id uuid, p_barcode text, p_employee_id uuid, p_duration_ms integer,
  p_scanner_device text, p_timezone text default 'Europe/Moscow', p_shift_id uuid default null,
  p_scanned_at_client timestamptz default now(), p_input_metadata jsonb default '{}'::jsonb
)
returns table (result text, orders_today bigint, earnings_today numeric, message text,
  last_interval_seconds numeric, median_interval_seconds numeric, interval_count bigint)
language plpgsql security definer set search_path=public as $$
declare
  v_barcode text := public.normalize_scan_barcode(p_barcode);
  v_scan scans%rowtype;
  v_existing scans%rowtype;
  v_result text;
  v_reason text;
  v_message text;
  v_orders bigint;
  v_earnings numeric;
  v_start timestamptz;
  v_end timestamptz;
  v_previous_at timestamptz;
  v_interval numeric;
  v_median numeric;
  v_interval_count bigint;
  v_received timestamptz := clock_timestamp();
begin
  perform pg_advisory_xact_lock(hashtextextended(p_event_id::text,0));
  return query
    select e.result,e.orders_today,e.earnings_today,e.message,
           s.order_interval_seconds,m.median_interval_seconds,m.interval_count
    from scanner_agent_events e
    left join scans s on s.id=e.scan_id
    left join lateral shift_order_metrics(e.shift_id) m on true
    where e.event_id=p_event_id;
  if found then return; end if;

  if p_shift_id is null or not exists(
    select 1 from work_shifts
    where id=p_shift_id and employee_id=p_employee_id and status='active' and ended_at is null
  ) then
    return query select 'rejected'::text,0::bigint,0::numeric,
      'Shift is not active'::text,null::numeric,null::numeric,0::bigint;
    return;
  end if;

  -- Serialise all decisions for one shift, including an offline queue replay.
  perform pg_advisory_xact_lock(hashtextextended(p_shift_id::text,1));

  if char_length(v_barcode) < 1 or char_length(v_barcode) > 512 then
    raise exception 'INVALID_BARCODE';
  end if;
  if not exists(select 1 from employees where id=p_employee_id and active) then
    raise exception 'EMPLOYEE_INACTIVE';
  end if;

  -- Preserve the existing input classification.
  if p_duration_ms is null
     or p_duration_ms < 0
     or p_duration_ms > 1500
     or char_length(v_barcode) < 8
     or (p_duration_ms::numeric / greatest(char_length(v_barcode)-1,1)) > 50 then
    v_result := 'rejected';
    v_reason := 'manual';
    v_message := 'Scan rejected';
  else
    -- Duplicate is determined globally by the normalized barcode.
    select s.* into v_existing from scans s where s.normalized_barcode=v_barcode;
    if v_existing.id is not null then
      v_result := 'duplicate';
      v_reason := 'duplicate';
      v_message := 'Duplicate - not counted';
    else
      -- This is the last successful physical scan in this active shift. Rejected
      -- attempts never enter `scans`. Intervals are statistics only.
      select s.scanned_at into v_previous_at
      from scans s
      where s.shift_id=p_shift_id
        and s.employee_id=p_employee_id
        and s.scanned_at <= p_scanned_at_client
      order by s.scanned_at desc,s.id desc
      limit 1;

      if v_previous_at is not null then
        v_interval := extract(epoch from (p_scanned_at_client-v_previous_at));
      end if;

      insert into scans(barcode,employee_id,scanned_at,received_at_server,shift_id)
      values(v_barcode,p_employee_id,p_scanned_at_client,v_received,p_shift_id)
      on conflict(normalized_barcode) do nothing
      returning * into v_scan;

      if v_scan.id is null then
        select s.* into v_existing from scans s where s.normalized_barcode=v_barcode;
        v_result := 'duplicate';
        v_reason := 'duplicate';
        v_message := 'Duplicate - not counted';
        v_interval := null;
      else
        v_result := 'counted';
        v_reason := 'counted';
        v_message := '+1 order';
        if v_previous_at is not null and exists(
          select 1 from work_shift_pauses p
          where p.shift_id=p_shift_id and p.started_at<p_scanned_at_client
            and coalesce(p.ended_at,v_received)>v_previous_at
        ) then
          v_interval := null;
        end if;
        update scans set order_interval_seconds=v_interval where id=v_scan.id;
      end if;
    end if;
  end if;

  insert into scan_attempts(
    barcode,employee_id,attempted_at,success,input_type,duration_ms,duplicate_of,reason,shift_id
  ) values(
    v_barcode,p_employee_id,p_scanned_at_client,v_result='counted',
    case when v_reason='manual' then 'manual' else 'scanner' end,
    greatest(coalesce(p_duration_ms,0),0),
    case when v_result='duplicate' then v_existing.id else null end,
    v_reason,p_shift_id
  );

  v_start := date_trunc('day',v_received at time zone p_timezone) at time zone p_timezone;
  v_end := v_start+interval '1 day';
  select count(*) into v_orders from scans
    where employee_id=p_employee_id and scanned_at>=v_start and scanned_at<v_end;
  select v_orders*price_per_order into v_earnings from settings where id=1;
  v_earnings := coalesce(v_earnings,0);
  select m.median_interval_seconds,m.interval_count into v_median,v_interval_count
    from shift_order_metrics(p_shift_id) m;

  insert into scanner_agent_events(
    event_id,employee_id,scanner_device,result,message,orders_today,earnings_today,
    shift_id,scan_id,scanned_at_client,received_at_server,input_metadata,barcode,reason
  ) values(
    p_event_id,p_employee_id,p_scanner_device,v_result,v_message,v_orders,v_earnings,
    p_shift_id,case when v_result='counted' then v_scan.id else null end,
    p_scanned_at_client,v_received,p_input_metadata,v_barcode,v_reason
  );

  return query select v_result,v_orders,v_earnings,v_message,
    case when v_result='counted' then v_interval else null end,
    v_median,coalesce(v_interval_count,0);
end $$;

revoke all on function public.register_agent_scan(uuid,text,uuid,integer,text,text,uuid,timestamptz,jsonb)
  from public,anon,authenticated;


commit;
