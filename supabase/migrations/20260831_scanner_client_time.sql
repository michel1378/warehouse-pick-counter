-- Preserve the physical scan time separately from receipt time. Existing rows/data are untouched.
alter table public.scans add column if not exists received_at_server timestamptz;
alter table public.scanner_agent_events
  add column if not exists scanned_at_client timestamptz,
  add column if not exists received_at_server timestamptz not null default now(),
  add column if not exists input_metadata jsonb not null default '{}'::jsonb;

drop function if exists public.register_agent_scan(uuid,text,uuid,integer,text,text,uuid,timestamptz,jsonb);
create function public.register_agent_scan(
  p_event_id uuid, p_barcode text, p_employee_id uuid, p_duration_ms integer,
  p_scanner_device text, p_timezone text default 'Europe/Moscow', p_shift_id uuid default null,
  p_scanned_at_client timestamptz default now(), p_input_metadata jsonb default '{}'::jsonb
)
returns table (result text, orders_today bigint, earnings_today numeric, message text,
  last_interval_seconds numeric, median_interval_seconds numeric, interval_count bigint)
language plpgsql security definer set search_path=public as $$
declare
  v_scan record; v_result text; v_message text; v_orders bigint; v_earnings numeric;
  v_start timestamptz; v_end timestamptz; v_previous_at timestamptz; v_interval numeric;
  v_median numeric; v_interval_count bigint; v_received timestamptz:=clock_timestamp();
begin
  perform pg_advisory_xact_lock(hashtextextended(p_event_id::text,0));
  return query select e.result,e.orders_today,e.earnings_today,e.message,s.order_interval_seconds,m.median_interval_seconds,m.interval_count
    from scanner_agent_events e left join scans s on s.id=e.scan_id
    left join lateral shift_order_metrics(e.shift_id) m on true where e.event_id=p_event_id;
  if found then return; end if;
  if p_shift_id is null or not exists(select 1 from work_shifts where id=p_shift_id and employee_id=p_employee_id and status='active' and ended_at is null) then
    return query select 'rejected'::text,0::bigint,0::numeric,'Смена не активна'::text,null::numeric,null::numeric,0::bigint; return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_shift_id::text,1));
  select * into v_scan from register_scan(p_barcode,p_employee_id,p_duration_ms,false);
  if v_scan.input_type='manual' then v_result:='rejected'; v_message:='Скан отклонён';
  elsif v_scan.success then
    v_result:='counted'; v_message:='+1 заказ';
    update scans set scanned_at=p_scanned_at_client,received_at_server=v_received,shift_id=p_shift_id where id=v_scan.scan_id;
    select s.scanned_at into v_previous_at from scans s where s.shift_id=p_shift_id and s.employee_id=p_employee_id and s.id<>v_scan.scan_id and s.scanned_at<p_scanned_at_client order by s.scanned_at desc limit 1;
    if v_previous_at is not null and not exists(select 1 from work_shift_pauses p where p.shift_id=p_shift_id and p.started_at<p_scanned_at_client and coalesce(p.ended_at,v_received)>v_previous_at) then v_interval:=extract(epoch from (p_scanned_at_client-v_previous_at)); end if;
    update scans set order_interval_seconds=v_interval where id=v_scan.scan_id;
  else v_result:='duplicate'; v_message:='Дубль — не засчитан'; end if;
  v_start:=(date_trunc('day',v_received at time zone p_timezone) at time zone p_timezone); v_end:=v_start+interval '1 day';
  select count(*) into v_orders from scans where employee_id=p_employee_id and scanned_at>=v_start and scanned_at<v_end;
  select v_orders*price_per_order into v_earnings from settings where id=1; v_earnings:=coalesce(v_earnings,0);
  select m.median_interval_seconds,m.interval_count into v_median,v_interval_count from shift_order_metrics(p_shift_id) m;
  insert into scanner_agent_events(event_id,employee_id,scanner_device,result,message,orders_today,earnings_today,shift_id,scan_id,scanned_at_client,received_at_server,input_metadata)
    values(p_event_id,p_employee_id,p_scanner_device,v_result,v_message,v_orders,v_earnings,p_shift_id,case when v_result='counted' then v_scan.scan_id else null end,p_scanned_at_client,v_received,p_input_metadata);
  return query select v_result,v_orders,v_earnings,v_message,v_interval,v_median,coalesce(v_interval_count,0);
end $$;
revoke all on function public.register_agent_scan(uuid,text,uuid,integer,text,text,uuid,timestamptz,jsonb) from public,anon,authenticated;
