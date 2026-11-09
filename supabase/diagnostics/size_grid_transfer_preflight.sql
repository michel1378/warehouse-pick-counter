-- READ ONLY. Run in SQL Editor of the Supabase project used by the production site.
-- Save the single JSON result as source-size-preflight.json in the project root.
-- No photo bytes, session tokens, API keys, or copies of owner examples are exported.
begin read only;
select jsonb_build_object(
  'captured_at', now(),
  'profile_column_exists', exists (
    select 1 from information_schema.columns where table_schema='public'
      and table_name='size_products' and column_name='size_profile'
  ),
  'profile_column_type', (
    select udt_name from information_schema.columns where table_schema='public'
      and table_name='size_products' and column_name='size_profile'
  ),
  'limits_table_exists', to_regclass('public.size_ai_limits') is not null,
  'limits_function_exists', to_regprocedure('public.take_size_ai_slot(uuid)') is not null,
  'products', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', p.id, 'name', p.name, 'revision', p.revision, 'updated_at', p.updated_at,
        'sizes', p.sizes, 'active', p.active,
        'show_in_sizes', p.show_in_sizes, 'show_in_availability', p.show_in_availability,
        'photo_count', p.photo_count, 'example_count', jsonb_array_length(p.examples),
        'photos_md5', md5((to_jsonb(p)->'photos')::text),
        'legacy_photo_md5', md5((to_jsonb(p)->'photo')::text),
        'examples_md5', md5(p.examples::text),
        'protected_fields_md5', md5((to_jsonb(p)-array['size_profile','revision','updated_at'])::text)
      ) || case when to_jsonb(p) ? 'size_profile'
        then jsonb_build_object('size_profile',to_jsonb(p)->'size_profile') else '{}'::jsonb end
      order by p.id
    ) from public.size_products p
    where p.id in ('7474f167-d6eb-46b6-82be-f07f2275b18f'::uuid,'a92d78d6-90c1-4938-8d14-f01859925511'::uuid)
       or lower(regexp_replace(trim(p.name),'\s+',' ','g')) in
          (lower('Брюки Огромнейшие'),lower('Лонгслив Альпака пуговицы (в полоску)'))
  ),'[]'::jsonb)
) as size_grid_preflight;
commit;
