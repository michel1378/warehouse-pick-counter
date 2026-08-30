create table if not exists public.work_shifts (
  id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.employees(id),
  started_at timestamptz not null default now(), ended_at timestamptz, status text not null default 'active' check (status in ('active','paused','finished')),
  active_seconds bigint not null default 0, pause_seconds bigint not null default 0, pause_count integer not null default 0,
  orders_count integer not null default 0, earnings numeric(12,2) not null default 0, median_interval_seconds numeric
);
create unique index if not exists one_open_shift_per_employee on public.work_shifts(employee_id) where ended_at is null;
create index if not exists work_shifts_employee_started_idx on public.work_shifts(employee_id, started_at desc);
create table if not exists public.work_shift_pauses (
  id uuid primary key default gen_random_uuid(), shift_id uuid not null references public.work_shifts(id) on delete cascade,
  started_at timestamptz not null default now(), ended_at timestamptz
);
create index if not exists shift_pauses_shift_idx on public.work_shift_pauses(shift_id, started_at);
alter table public.scans add column if not exists shift_id uuid references public.work_shifts(id);
alter table public.scanner_agent_events add column if not exists shift_id uuid references public.work_shifts(id);
alter table public.work_shifts enable row level security; alter table public.work_shift_pauses enable row level security;
revoke all on public.work_shifts, public.work_shift_pauses from anon, authenticated;

create or replace function public.register_agent_scan(p_event_id uuid, p_barcode text, p_employee_id uuid, p_duration_ms integer, p_scanner_device text, p_timezone text default 'Europe/Moscow', p_shift_id uuid default null)
returns table (result text, orders_today bigint, earnings_today numeric, message text)
language plpgsql security definer set search_path = public as $$
declare v_scan record; v_result text; v_message text; v_orders bigint; v_earnings numeric; v_start timestamptz; v_end timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_event_id::text, 0));
  return query select e.result,e.orders_today,e.earnings_today,e.message from scanner_agent_events e where e.event_id=p_event_id; if found then return; end if;
  if p_shift_id is null or not exists(select 1 from work_shifts where id=p_shift_id and employee_id=p_employee_id and status='active' and ended_at is null) then
    return query select 'rejected'::text,0::bigint,0::numeric,'Смена не активна'::text; return;
  end if;
  select * into v_scan from register_scan(p_barcode,p_employee_id,p_duration_ms,false);
  if v_scan.input_type='manual' then v_result:='rejected';v_message:='Скан отклонен'; elsif v_scan.success then v_result:='counted';v_message:='+1 заказ'; update scans set shift_id=p_shift_id where id=v_scan.scan_id; else v_result:='duplicate';v_message:='Дубль — не засчитан'; end if;
  v_start:=(date_trunc('day',now() at time zone p_timezone) at time zone p_timezone); v_end:=((date_trunc('day',now() at time zone p_timezone)+interval '1 day') at time zone p_timezone);
  select count(*) into v_orders from scans where employee_id=p_employee_id and scanned_at>=v_start and scanned_at<v_end; select v_orders*price_per_order into v_earnings from settings where id=1; v_earnings:=coalesce(v_earnings,0);
  insert into scanner_agent_events(event_id,employee_id,scanner_device,result,message,orders_today,earnings_today,shift_id) values(p_event_id,p_employee_id,p_scanner_device,v_result,v_message,v_orders,v_earnings,p_shift_id);
  return query select v_result,v_orders,v_earnings,v_message;
end $$;
revoke all on function public.register_agent_scan(uuid,text,uuid,integer,text,text,uuid) from public,anon,authenticated;
