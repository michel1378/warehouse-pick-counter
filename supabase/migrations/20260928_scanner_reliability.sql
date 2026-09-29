-- Forward-only. Prerequisites: baseline and migrations through 20260915.
-- No historical rows are deleted or rewritten. Missing audit columns are repaired.
begin;
set local lock_timeout = '5s';
alter table public.scan_attempts add column if not exists reason text,
  add column if not exists shift_id uuid references public.work_shifts(id);
alter table public.scanner_agent_events add column if not exists reason text,
  add column if not exists barcode text;
create table public.scanner_event_receipts (
  event_id uuid primary key, response jsonb not null, created_at timestamptz not null default now()
);
create table public.scanner_shift_operations (
  operation_id uuid primary key, employee_id uuid not null references public.employees(id),
  action text not null, shift_id uuid, response jsonb not null, created_at timestamptz not null default now()
);
alter table public.scanner_event_receipts enable row level security;
alter table public.scanner_shift_operations enable row level security;
revoke all on public.scanner_event_receipts,public.scanner_shift_operations from public,anon,authenticated;

-- Abort rather than silently repair inconsistent pause history.
create unique index scanner_one_open_pause on public.work_shift_pauses(shift_id) where ended_at is null;

create function public.scanner_shift_action(p_employee uuid,p_action text,p_operation uuid default null,p_shift uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare w work_shifts%rowtype; old scanner_shift_operations%rowtype; response jsonb;
  t timestamptz; added bigint; n bigint; price numeric; metrics record;
begin
  if p_operation is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_operation::text,3));
    select * into old from scanner_shift_operations where operation_id=p_operation;
    if found then
      if old.employee_id<>p_employee or old.action<>p_action or old.shift_id is distinct from p_shift then
        return jsonb_build_object('error','Operation identity mismatch');
      end if;
      return old.response;
    end if;
  end if;
  -- Same employee lock is used by scan, before checking shift state.
  perform pg_advisory_xact_lock(hashtextextended(p_employee::text,2));
  if not exists(select 1 from employees where id=p_employee and active and 'picking'=any(permissions)) then
    return jsonb_build_object('error','Employee inactive or picking permission missing');
  end if;
  select * into w from work_shifts where employee_id=p_employee and
    ((p_shift is not null and id=p_shift) or (p_shift is null and ended_at is null)) for update;
  t:=clock_timestamp();
  if p_action='start' then
    if w.id is null then insert into work_shifts(employee_id) values(p_employee) returning * into w;
    elsif w.status='finished' then return jsonb_build_object('error','Shift already finished'); end if;
  elsif w.id is null then
    -- Legacy finish retries: return the most recently finished shift, never create one.
    if p_action='finish' and p_shift is null then
      select * into w from work_shifts where employee_id=p_employee and status='finished' order by ended_at desc limit 1;
    end if;
    if w.id is null then return jsonb_build_object('error','Shift not found'); end if;
  end if;
  if p_action='pause' and w.status='active' then
    insert into work_shift_pauses(shift_id,started_at) values(w.id,t);
    update work_shifts set status='paused',pause_count=pause_count+1 where id=w.id returning * into w;
  elsif p_action in ('resume','finish') and w.status='paused' then
    update work_shift_pauses set ended_at=t where shift_id=w.id and ended_at is null
      returning greatest(0,floor(extract(epoch from(t-started_at))))::bigint into added;
    if not found then raise exception 'Open pause missing' using errcode='42703'; end if;
    update work_shifts set status='active',pause_seconds=pause_seconds+added where id=w.id returning * into w;
  end if;
  if p_action='finish' and w.status<>'finished' then
    select count(*) into n from scans where shift_id=w.id;
    select price_per_order into strict price from settings where id=1;
    select * into metrics from shift_order_metrics(w.id);
    update work_shifts set status='finished',ended_at=t,
      active_seconds=greatest(0,floor(extract(epoch from(t-started_at)))-pause_seconds),
      orders_count=n,earnings=n*price,median_interval_seconds=metrics.median_interval_seconds,
      average_interval_seconds=metrics.average_interval_seconds,interval_count=metrics.interval_count
      where id=w.id returning * into w;
  end if;
  if p_action not in ('start','pause','resume','finish') then return jsonb_build_object('error','Unknown action'); end if;
  if p_action in ('pause','resume') and w.status='finished' then return jsonb_build_object('error','Shift finished'); end if;
  response:=to_jsonb(w);
  if p_operation is not null then
    insert into scanner_shift_operations(operation_id,employee_id,action,shift_id,response) values(p_operation,p_employee,p_action,p_shift,response);
  end if;
  return response;
end $$;

create function public.scanner_scan_v2(p_request jsonb,p_probe boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare eid uuid; employee uuid; sid uuid; barcode_value text; at_client timestamptz;
  received timestamptz; duration integer; device text; result_value text:='rejected'; reason_value text;
  response jsonb; legacy scanner_agent_events%rowtype; w work_shifts%rowtype;
  scan_row scans%rowtype; duplicate_id uuid; previous_at timestamptz; interval_value numeric;
  metrics record; orders bigint:=0; earnings numeric:=0; day_start timestamptz; price numeric;
begin
  if p_probe then
    -- Read-only: execute column resolution and dependencies, never a synthetic INSERT.
    perform s.normalized_barcode,s.shift_id,s.received_at_server,s.order_interval_seconds from scans s limit 0;
    perform a.reason,a.shift_id,a.duplicate_of from scan_attempts a limit 0;
    perform e.reason,e.barcode,e.scan_id,e.input_metadata,e.scanned_at_client from scanner_agent_events e limit 0;
    perform ws.pause_seconds,ws.interval_count,ws.average_interval_seconds from work_shifts ws limit 0;
    perform p.ended_at from work_shift_pauses p limit 0;
    perform e.permissions,e.active from employees e limit 0;
    perform r.response from scanner_event_receipts r limit 0;
    perform o.response from scanner_shift_operations o limit 0;
    if exists (
      select 1 from (values
        ('scans','barcode','text'),('scans','normalized_barcode','text'),('scans','employee_id','uuid'),
        ('scans','shift_id','uuid'),('scans','scanned_at','timestamptz'),('scans','received_at_server','timestamptz'),
        ('scans','order_interval_seconds','numeric'),
        ('scan_attempts','reason','text'),('scan_attempts','shift_id','uuid'),
        ('scanner_agent_events','reason','text'),('scanner_agent_events','barcode','text'),
        ('scanner_agent_events','event_id','uuid'),('scanner_agent_events','input_metadata','jsonb'),
        ('work_shifts','status','text'),('work_shifts','pause_seconds','int8'),('work_shifts','orders_count','int4'),
        ('work_shift_pauses','started_at','timestamptz'),('work_shift_pauses','ended_at','timestamptz'),
        ('settings','price_per_order','numeric'),('scanner_event_receipts','response','jsonb')
      ) expected(tbl,col,typ)
      left join pg_attribute a on a.attrelid=to_regclass('public.'||expected.tbl)
        and a.attname=expected.col and not a.attisdropped
      where a.attnum is null or a.atttypid<>to_regtype(expected.typ)
    ) then raise exception 'Scan column type mismatch' using errcode='42703'; end if;
    select price_per_order into strict price from settings where id=1;
    perform * from shift_order_metrics(null);
    perform normalize_scan_barcode(' p12345678 ');
    if not has_table_privilege(current_user,'public.scans','INSERT,UPDATE')
      or not has_table_privilege(current_user,'public.scan_attempts','INSERT')
      or not has_table_privilege(current_user,'public.scanner_event_receipts','INSERT')
      or not has_table_privilege(current_user,'public.scanner_agent_events','INSERT') then
      raise exception 'Scan write privileges missing' using errcode='42501';
    end if;
    if to_regprocedure('public.scanner_shift_action(uuid,text,uuid,uuid)') is null
      or to_regprocedure('public.register_agent_scan(uuid,text,uuid,integer,text,text,uuid,timestamp with time zone,jsonb)') is null then
      raise exception 'Required RPC missing' using errcode='42883';
    end if;
    if not exists(select 1 from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attnum=i.indkey[0]
      where i.indrelid='scans'::regclass and a.attname='normalized_barcode' and a.attgenerated='s'
      and i.indisunique and i.indisvalid and i.indisready and i.indimmediate and i.indnkeyatts=1
      and i.indpred is null and i.indexprs is null) then
      raise exception 'Global barcode unique missing' using errcode='42703';
    end if;
    return jsonb_build_object('ready',true,'version',2,'backend',true,'database',true,'scanReady',true);
  end if;
  eid:=(p_request->>'event_id')::uuid;
  if eid is null then raise exception 'event_id required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(eid::text,0));
  select r.response into response from scanner_event_receipts r where r.event_id=eid;
  if found then return response; end if;
  -- Preserve acknowledgements created before this migration (no recount).
  select * into legacy from scanner_agent_events where event_id=eid;
  if found then
    response:=jsonb_build_object('eventId',eid,'acknowledged',true,'success',legacy.result='counted','result',legacy.result,
      'reason',coalesce(legacy.reason,legacy.result),'message',legacy.message,'ordersToday',legacy.orders_today,'earningsToday',legacy.earnings_today);
    insert into scanner_event_receipts values(eid,response,now()); return response;
  end if;
  employee:=(p_request->>'employee_id')::uuid; sid:=(p_request->>'shift_id')::uuid;
  barcode_value:=normalize_scan_barcode(p_request->>'barcode'); duration:=(p_request->>'duration_ms')::integer;
  device:=p_request->>'scanner_device'; at_client:=(p_request->>'scanned_at')::timestamptz;
  if employee is not null then perform pg_advisory_xact_lock(hashtextextended(employee::text,2)); end if;
  received:=clock_timestamp();
  select * into w from work_shifts where id=sid and employee_id=employee for update;
  if not exists(select 1 from employees where id=employee and active and 'picking'=any(permissions)) then reason_value:='employee_inactive';
  elsif barcode_value is null or length(barcode_value)>512 or not (barcode_value ~ '^[0-9]+$' and length(barcode_value)>=8 or barcode_value ~ '^P[0-9]+$' and length(barcode_value)>=9) then reason_value:='invalid_barcode';
  elsif w.id is null or w.status<>'active' or w.ended_at is not null then reason_value:='shift_inactive';
  elsif at_client is null then reason_value:='invalid_timestamp';
  elsif duration is null or duration<0 or duration>1500 or duration::numeric/greatest(length(barcode_value)-1,1)>50 then reason_value:='manual_input';
  else
    select scanned_at into previous_at from scans where shift_id=sid and scanned_at<=at_client order by scanned_at desc limit 1;
    insert into scans(barcode,employee_id,shift_id,scanned_at,received_at_server)
      values(barcode_value,employee,sid,at_client,received) on conflict(normalized_barcode) do nothing returning * into scan_row;
    if scan_row.id is null then
      result_value:='duplicate'; reason_value:='duplicate';
      select id into duplicate_id from scans where normalized_barcode=barcode_value;
    else
      result_value:='counted'; reason_value:='counted';
      if previous_at is not null and not exists(select 1 from work_shift_pauses where shift_id=sid
          and started_at<at_client and coalesce(ended_at,received)>previous_at) then
        interval_value:=extract(epoch from(at_client-previous_at));
      end if;
      update scans set order_interval_seconds=interval_value where id=scan_row.id;
    end if;
  end if;
  day_start:=date_trunc('day',received at time zone coalesce(p_request->>'timezone','Europe/Moscow')) at time zone coalesce(p_request->>'timezone','Europe/Moscow');
  select count(*) into orders from scans where employee_id=employee and scanned_at>=day_start and scanned_at<day_start+interval '1 day';
  select price_per_order into strict price from settings where id=1; earnings:=orders*price;
  select * into metrics from shift_order_metrics(w.id);
  response:=jsonb_build_object('eventId',eid,'acknowledged',true,'success',result_value='counted','result',result_value,
    'reason',reason_value,'message',case reason_value when 'counted' then '+1 заказ' when 'duplicate' then 'Дубликат — не засчитан'
      when 'employee_inactive' then 'Сотрудник отключён или нет права сборки' when 'shift_inactive' then 'Смена не активна'
      when 'invalid_barcode' then 'Недопустимый штрихкод' when 'invalid_timestamp' then 'Некорректное время сканирования' else 'Ручной ввод не засчитан' end,
    'ordersToday',orders,'earningsToday',earnings,'lastIntervalSeconds',interval_value,
    'medianIntervalSeconds',metrics.median_interval_seconds,'intervalCount',coalesce(metrics.interval_count,0));
  -- Receipts deliberately have no employee FK: missing employees are durable business rejections too.
  insert into scanner_event_receipts(event_id,response) values(eid,response);
  if exists(select 1 from employees where id=employee) then
    insert into scan_attempts(barcode,employee_id,attempted_at,success,input_type,duration_ms,duplicate_of,reason,shift_id)
      values(coalesce(barcode_value,''),employee,coalesce(at_client,received),result_value='counted',case when reason_value='manual_input' then 'manual' else 'scanner' end,greatest(coalesce(duration,0),0),duplicate_id,reason_value,w.id);
    insert into scanner_agent_events(event_id,employee_id,scanner_device,result,message,orders_today,earnings_today,shift_id,scan_id,scanned_at_client,received_at_server,input_metadata,barcode,reason)
      values(eid,employee,device,result_value,response->>'message',orders,earnings,w.id,scan_row.id,at_client,received,coalesce(p_request->'input_metadata','{}'),barcode_value,reason_value);
  end if;
  return response;
end $$;

-- Keep the old endpoint/RPC wire contract during staged rollout.
create or replace function public.register_agent_scan(p_event_id uuid,p_barcode text,p_employee_id uuid,p_duration_ms integer,p_scanner_device text,p_timezone text default 'Europe/Moscow',p_shift_id uuid default null,p_scanned_at_client timestamptz default now(),p_input_metadata jsonb default '{}')
returns table(result text,orders_today bigint,earnings_today numeric,message text,last_interval_seconds numeric,median_interval_seconds numeric,interval_count bigint)
language sql security definer set search_path=public as $$
  select r->>'result',(r->>'ordersToday')::bigint,(r->>'earningsToday')::numeric,r->>'message',
    (r->>'lastIntervalSeconds')::numeric,(r->>'medianIntervalSeconds')::numeric,coalesce((r->>'intervalCount')::bigint,0)
  from (select scanner_scan_v2(jsonb_build_object('event_id',p_event_id,'barcode',p_barcode,'employee_id',p_employee_id,
    'duration_ms',p_duration_ms,'scanner_device',p_scanner_device,'timezone',p_timezone,'shift_id',p_shift_id,
    'scanned_at',p_scanned_at_client,'input_metadata',p_input_metadata),false) r) q
$$;
revoke all on function public.scanner_scan_v2(jsonb,boolean),public.scanner_shift_action(uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.scanner_scan_v2(jsonb,boolean),public.scanner_shift_action(uuid,text,uuid,uuid) to service_role;
grant execute on function public.register_agent_scan(uuid,text,uuid,integer,text,text,uuid,timestamptz,jsonb) to service_role;
-- Assert the prerequisite schema inside the migration transaction.
select public.scanner_scan_v2('{}',true);
commit;
