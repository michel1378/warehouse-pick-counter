-- Apply only after deploying the version without the Reviews pages and API.
-- Removes the retired section's history and permission, preserving all other data.
begin;
drop table if exists public.ai_review_requests;
update public.employees
set permissions = array_remove(permissions, 'reviews')
where permissions @> array['reviews']::text[];
commit;
