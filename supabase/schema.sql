create extension if not exists pgcrypto;

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 120),
  pin_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.admins (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 120),
  pin_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.scans (
  id uuid primary key default gen_random_uuid(),
  barcode text unique not null check (char_length(barcode) between 1 and 512),
  employee_id uuid not null references public.employees(id),
  scanned_at timestamptz not null default now()
);

create table if not exists public.scan_attempts (
  id uuid primary key default gen_random_uuid(),
  barcode text not null,
  employee_id uuid not null references public.employees(id),
  attempted_at timestamptz not null default now(),
  success boolean not null,
  input_type text not null default 'scanner' check (input_type in ('scanner', 'manual')),
  duration_ms integer not null default 0 check (duration_ms >= 0),
  duplicate_of uuid references public.scans(id)
);

create table if not exists public.settings (
  id smallint primary key default 1 check (id = 1),
  price_per_order numeric(12,2) not null default 23 check (price_per_order >= 0)
);

insert into public.settings (id, price_per_order)
values (1, 23)
on conflict (id) do nothing;

create index if not exists scans_employee_scanned_at_idx
  on public.scans (employee_id, scanned_at desc);
create index if not exists scan_attempts_employee_attempted_at_idx
  on public.scan_attempts (employee_id, attempted_at desc);

-- Одна транзакция одновременно создает scan и audit-запись попытки.
-- UNIQUE(scans.barcode) остается окончательной защитой при конкурентных запросах.
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
  v_barcode text := trim(p_barcode);
  v_scan scans%rowtype;
begin
  if char_length(v_barcode) < 1 or char_length(v_barcode) > 512 then
    raise exception 'INVALID_BARCODE';
  end if;

  if not exists (select 1 from employees where id = p_employee_id and active) then
    raise exception 'EMPLOYEE_INACTIVE';
  end if;

  -- Сервер БД повторно классифицирует ввод. Клиентский input_type не принимается.
  if p_was_paste
     or p_duration_ms is null
     or p_duration_ms < 0
     or p_duration_ms > 1500
     or char_length(v_barcode) < 8
     or (p_duration_ms::numeric / greatest(char_length(v_barcode) - 1, 1)) > 50 then
    insert into scan_attempts (barcode, employee_id, success, input_type, duration_ms, duplicate_of)
    values (v_barcode, p_employee_id, false, 'manual', greatest(coalesce(p_duration_ms, 0), 0), null);
    return query select false, null::uuid, null::timestamptz, null::text, 'manual'::text;
    return;
  end if;

  insert into scans (barcode, employee_id)
  values (v_barcode, p_employee_id)
  on conflict (barcode) do nothing
  returning * into v_scan;

  if v_scan.id is not null then
    insert into scan_attempts (barcode, employee_id, success, input_type, duration_ms, duplicate_of)
    values (v_barcode, p_employee_id, true, 'scanner', p_duration_ms, null);
    return query select true, v_scan.id, v_scan.scanned_at, null::text, 'scanner'::text;
  else
    select s.* into v_scan from scans s where s.barcode = v_barcode;
    insert into scan_attempts (barcode, employee_id, success, input_type, duration_ms, duplicate_of)
    values (v_barcode, p_employee_id, false, 'scanner', p_duration_ms, v_scan.id);
    return query
      select false, v_scan.id, v_scan.scanned_at, e.name, 'scanner'::text
      from employees e where e.id = v_scan.employee_id;
  end if;
end;
$$;

alter table public.employees enable row level security;
alter table public.admins enable row level security;
alter table public.scans enable row level security;
alter table public.scan_attempts enable row level security;
alter table public.settings enable row level security;

-- Приложение обращается к БД только серверным service-role клиентом.
revoke all on all tables in schema public from anon, authenticated;
revoke all on function public.register_scan(text, uuid, integer, boolean) from public, anon, authenticated;

create or replace function public.employee_stats(p_from timestamptz, p_to timestamptz)
returns table (id uuid, name text, successful bigint, duplicates bigint)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, e.name,
    count(distinct s.id) filter (where s.scanned_at >= p_from and s.scanned_at < p_to) as successful,
    count(distinct a.id) filter (where not a.success and a.attempted_at >= p_from and a.attempted_at < p_to) as duplicates
  from employees e
  left join scans s on s.employee_id = e.id and s.scanned_at >= p_from and s.scanned_at < p_to
  left join scan_attempts a on a.employee_id = e.id and not a.success and a.attempted_at >= p_from and a.attempted_at < p_to
  group by e.id, e.name
  order by e.name;
$$;

revoke all on function public.employee_stats(timestamptz, timestamptz) from public, anon, authenticated;

-- Поддержка Windows scanner-agent и идемпотентных event_id находится в
-- migrations/20260830_scanner_agent.sql (примените после этого файла).

-- Создание первого администратора (замените значения; PIN в открытом виде не хранится):
-- insert into public.admins (name, pin_hash)
-- values ('Администратор', crypt('ВАШ_СЛОЖНЫЙ_PIN', gen_salt('bf', 12)));
