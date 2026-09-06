-- Audit history and database-backed rate limiting for the Reviews AI tools.
create table if not exists public.ai_review_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  type text not null check (type in ('customer_message','review_appeal')),
  source jsonb not null default '{}'::jsonb,
  result text not null,
  model text not null,
  usage jsonb,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists ai_review_requests_employee_created_idx
  on public.ai_review_requests(employee_id,created_at desc);
create index if not exists ai_review_requests_type_created_idx
  on public.ai_review_requests(type,created_at desc);

alter table public.ai_review_requests enable row level security;
revoke all on public.ai_review_requests from public,anon,authenticated;

-- Existing employees keep their current permissions. Administrators assign
-- `reviews` explicitly from the employee editor.
