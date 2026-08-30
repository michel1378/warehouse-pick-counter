-- Рабочее время заказа: интервал между успешными уникальными сканами одной смены.
-- duration_ms остается технической характеристикой ввода и в KPI не участвует.
alter table public.scans
  add column if not exists order_interval_seconds numeric;

alter table public.work_shifts
  add column if not exists average_interval_seconds numeric,
  add column if not exists interval_count integer not null default 0;

-- Связь нужна для точного идемпотентного ответа агента.
alter table public.scanner_agent_events
  add column if not exists scan_id uuid references public.scans(id);

create index if not exists scans_shift_scanned_at_idx
  on public.scans (shift_id, scanned_at);

-- Восстанавливаем интервалы старых смен, не пересекая границы смен и паузы.
with ordered as (
  select s.id,s.shift_id,s.scanned_at,
         lag(s.scanned_at) over (partition by s.shift_id order by s.scanned_at,s.id) as previous_at
  from scans s where s.shift_id is not null
), valid as (
  select o.id,extract(epoch from (o.scanned_at-o.previous_at)) as seconds
  from ordered o
  where o.previous_at is not null and not exists (
    select 1 from work_shift_pauses p
    where p.shift_id=o.shift_id and p.started_at<o.scanned_at
      and coalesce(p.ended_at,'infinity'::timestamptz)>o.previous_at
  )
)
update scans s set order_interval_seconds=v.seconds from valid v where s.id=v.id;

create or replace function public.shift_order_metrics(p_shift_id uuid)
returns table (median_interval_seconds numeric, average_interval_seconds numeric, interval_count bigint)
language sql stable security definer set search_path = public as $$
  select
    percentile_cont(0.5) within group (order by s.order_interval_seconds)::numeric,
    avg(s.order_interval_seconds)::numeric,
    count(s.order_interval_seconds)
  from scans s
  where s.shift_id = p_shift_id and s.order_interval_seconds is not null
$$;

revoke all on function public.shift_order_metrics(uuid) from public, anon, authenticated;

-- Обновляем сохраненные итоги завершенных смен после backfill.
update work_shifts w set
  (median_interval_seconds,average_interval_seconds,interval_count) =
  (select m.median_interval_seconds,m.average_interval_seconds,m.interval_count::integer
   from shift_order_metrics(w.id) m)
where w.status='finished';

drop function if exists public.register_agent_scan(uuid,text,uuid,integer,text,text,uuid);
create function public.register_agent_scan(
  p_event_id uuid, p_barcode text, p_employee_id uuid, p_duration_ms integer,
  p_scanner_device text, p_timezone text default 'Europe/Moscow', p_shift_id uuid default null
)
returns table (
  result text, orders_today bigint, earnings_today numeric, message text,
  last_interval_seconds numeric, median_interval_seconds numeric, interval_count bigint
)
language plpgsql security definer set search_path = public as $$
declare
  v_scan record; v_result text; v_message text; v_orders bigint; v_earnings numeric;
  v_start timestamptz; v_end timestamptz; v_previous_at timestamptz;
  v_interval numeric; v_median numeric; v_interval_count bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_event_id::text, 0));
  return query
    select e.result,e.orders_today,e.earnings_today,e.message,
           s.order_interval_seconds,m.median_interval_seconds,m.interval_count
    from scanner_agent_events e
    left join scans s on s.id = e.scan_id
    left join lateral shift_order_metrics(e.shift_id) m on true
    where e.event_id=p_event_id;
  if found then return; end if;

  if p_shift_id is null or not exists(
    select 1 from work_shifts
    where id=p_shift_id and employee_id=p_employee_id and status='active' and ended_at is null
  ) then
    return query select 'rejected'::text,0::bigint,0::numeric,'Смена не активна'::text,null::numeric,null::numeric,0::bigint;
    return;
  end if;

  -- Последовательные сканы одной смены должны видеть результат друг друга.
  perform pg_advisory_xact_lock(hashtextextended(p_shift_id::text, 1));

  select * into v_scan from register_scan(p_barcode,p_employee_id,p_duration_ms,false);
  if v_scan.input_type='manual' then
    v_result:='rejected'; v_message:='Скан отклонен';
  elsif v_scan.success then
    v_result:='counted'; v_message:='+1 заказ';
    select s.scanned_at into v_previous_at
    from scans s
    where s.shift_id=p_shift_id and s.employee_id=p_employee_id and s.id<>v_scan.scan_id
      and s.scanned_at < v_scan.scanned_at
    order by s.scanned_at desc limit 1;

    if v_previous_at is not null and not exists (
      select 1 from work_shift_pauses p
      where p.shift_id=p_shift_id
        and p.started_at < v_scan.scanned_at
        and coalesce(p.ended_at, now()) > v_previous_at
    ) then
      v_interval := extract(epoch from (v_scan.scanned_at-v_previous_at));
    end if;
    update scans set shift_id=p_shift_id, order_interval_seconds=v_interval where id=v_scan.scan_id;
  else
    v_result:='duplicate'; v_message:='Дубль — не засчитан';
  end if;

  v_start:=(date_trunc('day',now() at time zone p_timezone) at time zone p_timezone);
  v_end:=((date_trunc('day',now() at time zone p_timezone)+interval '1 day') at time zone p_timezone);
  select count(*) into v_orders from scans where employee_id=p_employee_id and scanned_at>=v_start and scanned_at<v_end;
  select v_orders*price_per_order into v_earnings from settings where id=1;
  v_earnings:=coalesce(v_earnings,0);
  select m.median_interval_seconds,m.interval_count into v_median,v_interval_count from shift_order_metrics(p_shift_id) m;

  insert into scanner_agent_events(event_id,employee_id,scanner_device,result,message,orders_today,earnings_today,shift_id,scan_id)
  values(p_event_id,p_employee_id,p_scanner_device,v_result,v_message,v_orders,v_earnings,p_shift_id,
         case when v_result='counted' then v_scan.scan_id else null end);
  return query select v_result,v_orders,v_earnings,v_message,v_interval,v_median,coalesce(v_interval_count,0);
end $$;

revoke all on function public.register_agent_scan(uuid,text,uuid,integer,text,text,uuid) from public,anon,authenticated;
