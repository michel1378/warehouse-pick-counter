# warehouse-pick-counter

Счетчик сборки складских заказов на Next.js 15, TypeScript, App Router и Supabase/PostgreSQL.

## Запуск

1. Создайте проект Supabase и выполните `supabase/schema.sql` в SQL Editor.
2. Создайте `.env.local` по образцу `.env.example`.
3. Создайте первого администратора SQL-командой, описанной в конце `supabase/schema.sql`.
4. Выполните `npm install`, затем `npm run dev`.

Сервисный ключ Supabase используется только в Server Actions/Server Components и не попадает в браузер.
