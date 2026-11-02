-- Allow name-only positions in the shared catalog. Existing rows are not changed.
begin;
alter table public.size_products drop constraint if exists size_products_sizes_check;
alter table public.size_products add constraint size_products_sizes_check
  check (jsonb_typeof(sizes) = 'array' and jsonb_array_length(sizes) between 0 and 30);
alter table public.size_products drop constraint if exists size_products_photos_check;
alter table public.size_products add constraint size_products_photos_check
  check (jsonb_typeof(photos) = 'array' and jsonb_array_length(photos) between 0 and 6 and photo_count between 0 and 6);
commit;
