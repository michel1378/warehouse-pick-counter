-- Additive migration: existing intervals and employee clock functions stay intact.
begin;

create table public.employee_time_session_edits (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.employee_time_sessions(id),
  employee_id uuid not null references public.employees(id),
  old_started_at timestamptz not null,
  old_ended_at timestamptz,
  new_started_at timestamptz not null,
  new_ended_at timestamptz,
  edited_at timestamptz not null default clock_timestamp(),
  edited_by uuid not null references public.admins(id),
  reason text check (char_length(reason) <= 2000)
);
create index employee_time_session_edits_session_idx
  on public.employee_time_session_edits(session_id, edited_at desc);
alter table public.employee_time_session_edits enable row level security;
revoke all on public.employee_time_session_edits from public, anon, authenticated;
grant select, insert on public.employee_time_session_edits to service_role;

create function public.admin_edit_employee_time_session(
  p_session_id uuid, p_admin_id uuid,
  p_expected_started_at timestamptz, p_expected_ended_at timestamptz,
  p_started_at timestamptz, p_ended_at timestamptz,
  p_finish_now boolean, p_reason text
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_employee_id uuid;
  v_old public.employee_time_sessions%rowtype;
  v_end timestamptz;
  v_now timestamptz;
begin
  if not exists(select 1 from public.admins where id = p_admin_id and active) then
    raise exception 'ADMIN_REQUIRED';
  end if;
  select employee_id into v_employee_id from public.employee_time_sessions where id = p_session_id;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  -- Same lock as start_employee_time_session / finish_employee_time_session.
  perform pg_advisory_xact_lock(hashtextextended(v_employee_id::text, 2));
  select * into v_old from public.employee_time_sessions where id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if v_old.started_at is distinct from p_expected_started_at
     or v_old.ended_at is distinct from p_expected_ended_at then
    raise exception 'SESSION_CHANGED';
  end if;
  v_now := clock_timestamp();
  if p_finish_now is null then raise exception 'INVALID_INTERVAL'; end if;
  if p_finish_now then
    if v_old.ended_at is not null then raise exception 'SESSION_CHANGED'; end if;
    -- Finishing is a separate action; never apply unsaved timestamp edits here.
    p_started_at := v_old.started_at;
    v_end := v_now;
  else
    v_end := p_ended_at;
    if (v_old.ended_at is null) <> (v_end is null) then
      raise exception 'ACTIVE_STATE_CHANGE';
    end if;
  end if;
  if p_started_at is null or not isfinite(p_started_at) or p_started_at > v_now
     or (v_end is not null and (not isfinite(v_end) or v_end > v_now or p_started_at >= v_end)) then
    raise exception 'INVALID_INTERVAL';
  end if;
  if exists (
    select 1 from public.employee_time_sessions s
    where s.employee_id = v_employee_id and s.id <> p_session_id
      and s.started_at < coalesce(v_end, 'infinity'::timestamptz)
      and coalesce(s.ended_at, 'infinity'::timestamptz) > p_started_at
  ) then raise exception 'INTERVAL_OVERLAP'; end if;
  if v_end is null and exists (
    select 1 from public.employee_time_sessions where employee_id = v_employee_id
      and id <> p_session_id and ended_at is null
  ) then raise exception 'SESSION_ALREADY_ACTIVE'; end if;
  if char_length(p_reason) > 2000 then raise exception 'REASON_TOO_LONG'; end if;
  if v_old.started_at = p_started_at and v_old.ended_at is not distinct from v_end then return; end if;
  insert into public.employee_time_session_edits (
    session_id, employee_id, old_started_at, old_ended_at, new_started_at, new_ended_at, edited_by, reason
  ) values (p_session_id, v_employee_id, v_old.started_at, v_old.ended_at,
    p_started_at, v_end, p_admin_id, nullif(btrim(p_reason), ''));
  update public.employee_time_sessions set started_at = p_started_at, ended_at = v_end where id = p_session_id;
end $$;
revoke all on function public.admin_edit_employee_time_session(uuid,uuid,timestamptz,timestamptz,timestamptz,timestamptz,boolean,text) from public,anon,authenticated;
grant execute on function public.admin_edit_employee_time_session(uuid,uuid,timestamptz,timestamptz,timestamptz,timestamptz,boolean,text) to service_role;
commit;
