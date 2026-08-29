-- Неразрушающая миграция: существующие попытки помечаются как scanner с duration_ms = 0.
alter table public.scan_attempts
  add column if not exists input_type text,
  add column if not exists duration_ms integer;

update public.scan_attempts set input_type = 'scanner' where input_type is null;
update public.scan_attempts set duration_ms = 0 where duration_ms is null;

alter table public.scan_attempts
  alter column input_type set default 'scanner',
  alter column input_type set not null,
  alter column duration_ms set default 0,
  alter column duration_ms set not null;

alter table public.scan_attempts drop constraint if exists scan_attempts_input_type_check;
alter table public.scan_attempts add constraint scan_attempts_input_type_check
  check (input_type in ('scanner', 'manual'));
alter table public.scan_attempts drop constraint if exists scan_attempts_duration_ms_check;
alter table public.scan_attempts add constraint scan_attempts_duration_ms_check
  check (duration_ms >= 0);

drop function if exists public.register_scan(text, uuid);
drop function if exists public.register_scan(text, uuid, integer, boolean);

create function public.register_scan(
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

revoke all on function public.register_scan(text, uuid, integer, boolean)
  from public, anon, authenticated;
