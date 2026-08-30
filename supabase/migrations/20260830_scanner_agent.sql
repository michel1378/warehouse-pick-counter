create table if not exists public.scanner_agent_events (
  event_id uuid primary key,
  employee_id uuid not null references public.employees(id),
  scanner_device text not null check (char_length(scanner_device) between 1 and 1024),
  result text not null check (result in ('counted', 'duplicate', 'rejected')),
  message text not null,
  orders_today bigint not null,
  earnings_today numeric(12,2) not null,
  created_at timestamptz not null default now()
);

alter table public.scanner_agent_events enable row level security;
revoke all on public.scanner_agent_events from anon, authenticated;

create or replace function public.register_agent_scan(
  p_event_id uuid, p_barcode text, p_employee_id uuid, p_duration_ms integer,
  p_scanner_device text, p_timezone text default 'Europe/Moscow'
)
returns table (result text, orders_today bigint, earnings_today numeric, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_scan record;
  v_result text;
  v_message text;
  v_orders bigint;
  v_earnings numeric;
  v_start timestamptz;
  v_end timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_event_id::text, 0));
  return query select e.result, e.orders_today, e.earnings_today, e.message
    from scanner_agent_events e where e.event_id = p_event_id;
  if found then return; end if;

  select * into v_scan from register_scan(p_barcode, p_employee_id, p_duration_ms, false);
  if v_scan.input_type = 'manual' then
    v_result := 'rejected'; v_message := 'Скан отклонён';
  elsif v_scan.success then
    v_result := 'counted'; v_message := '+1 заказ';
  else
    v_result := 'duplicate'; v_message := 'Дубль — не засчитан';
  end if;

  v_start := (date_trunc('day', now() at time zone p_timezone) at time zone p_timezone);
  v_end := ((date_trunc('day', now() at time zone p_timezone) + interval '1 day') at time zone p_timezone);
  select count(*) into v_orders from scans
    where employee_id = p_employee_id and scanned_at >= v_start and scanned_at < v_end;
  select v_orders * price_per_order into v_earnings from settings where id = 1;
  v_earnings := coalesce(v_earnings, 0);
  if v_result = 'counted' then v_message := '+1 заказ. Сегодня: ' || v_orders; end if;

  insert into scanner_agent_events(event_id, employee_id, scanner_device, result, message, orders_today, earnings_today)
  values (p_event_id, p_employee_id, p_scanner_device, v_result, v_message, v_orders, v_earnings);
  return query select v_result, v_orders, v_earnings, v_message;
end;
$$;

revoke all on function public.register_agent_scan(uuid,text,uuid,integer,text,text) from public, anon, authenticated;
