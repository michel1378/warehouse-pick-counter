-- Online employee access and server-authoritative attendance sessions.
alter table public.employees add column if not exists role text not null default 'warehouse';
alter table public.employees drop constraint if exists employees_role_check;
alter table public.employees add constraint employees_role_check check (role in ('warehouse','online'));
alter table public.employees add column if not exists permissions text[] not null default array['picking']::text[];

update public.employees set permissions=array['picking']::text[] where permissions is null or cardinality(permissions)=0;

create table if not exists public.employee_time_sessions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  started_at timestamptz not null default clock_timestamp(),
  ended_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  constraint employee_time_sessions_order_check check (ended_at is null or ended_at >= started_at)
);

create unique index if not exists employee_time_sessions_one_active_idx
  on public.employee_time_sessions(employee_id) where ended_at is null;
create index if not exists employee_time_sessions_employee_started_idx
  on public.employee_time_sessions(employee_id,started_at desc);

alter table public.employee_time_sessions enable row level security;
revoke all on public.employee_time_sessions from public,anon,authenticated;

create or replace function public.start_employee_time_session(p_employee_id uuid)
returns public.employee_time_sessions language plpgsql security definer set search_path=public as $$
declare v_session employee_time_sessions%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_employee_id::text,2));
  if not exists(select 1 from employees where id=p_employee_id and active and 'attendance'=any(permissions)) then
    raise exception 'EMPLOYEE_NOT_ALLOWED';
  end if;
  if exists(select 1 from employee_time_sessions where employee_id=p_employee_id and ended_at is null) then
    raise exception 'SESSION_ALREADY_ACTIVE';
  end if;
  insert into employee_time_sessions(employee_id) values(p_employee_id) returning * into v_session;
  return v_session;
end $$;

create or replace function public.finish_employee_time_session(p_employee_id uuid)
returns public.employee_time_sessions language plpgsql security definer set search_path=public as $$
declare v_session employee_time_sessions%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_employee_id::text,2));
  update employee_time_sessions set ended_at=clock_timestamp()
  where id=(select id from employee_time_sessions where employee_id=p_employee_id and ended_at is null order by started_at desc limit 1)
  returning * into v_session;
  if v_session.id is null then raise exception 'NO_ACTIVE_SESSION'; end if;
  return v_session;
end $$;

revoke all on function public.start_employee_time_session(uuid) from public,anon,authenticated;
revoke all on function public.finish_employee_time_session(uuid) from public,anon,authenticated;
