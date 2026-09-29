# Итоговый отчёт — 29 сентября 2026

Работа продолжена поверх исходных незакоммиченных изменений. Production SQL не выполнялся, deploy не выполнялся, EXE на рабочих ноутбуках не заменялся. `dotnet publish` создал только локальный артефакт.

## A. Root causes

Подтверждено чтением кода и локальными regression tests; причины конкретного production-инцидента без проверки production не утверждаются.

- Liveness endpoint не доказывал готовность реального scan RPC и схемы.
- Разные классы ошибок не имели надёжного разделения: временный сбой, ошибочная конфигурация и окончательный business result требуют разного обращения с pending.
- Без durable receipt повтор после потерянного ответа мог отличаться от первоначального результата; локальное удаление требует сначала сохранить подтверждение.
- Нетранзакционные действия смен конкурировали со сканированием и завершением смены.
- Нормализация могла различаться между C#, backend и SQL; удаление внутренних разделителей меняет идентичность кода.
- UI показывал готовность сканера до discovery; сброс busy включал недопустимые кнопки; таймер/завершение действия могли заменить Checking устаревшей активной сменой.
- Незавершённые HID-пакеты молча сбрасывались по timeout/изменению устройств.

## B. Исправления и поведение

- Readiness проверяет actual scan RPC, зависимости, схему, права и глобальную уникальность без записи заказов.
- Server отображает Connecting / Ready / Temporarily unavailable / Configuration error; отсутствие настройки и локальные ошибки чтения конфигурации не оставляют Ready. Scanner показывает Disconnected до успешного обнаружения, затем Ready.
- Queue имеет независимый индикатор: неизвестное состояние при загрузке, ошибка чтения либо точный pending count. «Все данные синхронизированы» устанавливается только при прочитанном count == 0.
- Shift Checking сохраняется при неопределённом исходе действия и блокирует кнопки до reconciliation. Таймер его не перезаписывает. Busy больше не включает все кнопки без учёта статуса.
- Каждый принятый пакет привязанного сканера получает локальный результат или причину отклонения; бизнес-ответ отображается как +1 / Дубликат / Отклонён. Есть история последних 200 сообщений. Пакеты без терминатора, переполнение и неподдерживаемые символы дают ошибку сканера. Обычная клавиатура и чужой непривязанный HID не считаются сканами данного агента. Установочный скан отдельно подтверждает настройку и не создаёт заказ.
- Retry: 1, 2, 5, 10, 15 секунд, далее фоновая проверка каждые 15 секунд; auth/config/schema — каждые 60 секунд. Успешное восстановление сбрасывает последовательность.
- Network/5xx/429/auth/config/schema не удаляют pending. Только валидный серверный acknowledged с совпадающим eventId и business result архивируется в encrypted receipt, после чего удаляется из pending.
- Очередь DPAPI переживает новый процесс; eventId, сотрудник, смена, исходное время и barcode сохраняются. Повреждённая очередь не перезаписывается пустой.
- Start/pause/resume/finish выполняются транзакционно; после timeout клиент читает фактическое состояние, не предполагает успех. Неопределённость сохраняется в session.
- Employee switch разрешён после синхронизации pending. При pending > 0 переключение явно блокируется; fingerprint и очередь сохраняются. Это намеренное ограничение, не обещание offline-переключения сотрудника.
- Общие fixtures проверяют numeric, P, p → P, leading zeroes, внешние whitespace и сохранение внутренних разделителей. `P123` и `p123` нормализуются в `P123`, но не проходят прежнее правило длины: минимум 8 цифр. Разрешение коротких кодов не вводилось.
- В новом scan path нет too_fast, min_order_interval_seconds или 20-second cooldown. Исторические миграции/поля сохранены. Два разных допустимых кода через 1 секунду засчитываются.
- Глобальная уникальность применяется между сотрудниками/сменами; receipt делает повтор одного eventId идемпотентным.

## C. Полный список изменённых/новых исходных файлов

Список всей накопленной работы относительно HEAD, включая предыдущую часть задачи:

```text
README.md
package.json
package-lock.json
docs/scanner-reliability-review.md
docs/scanner-reliability-final.md
scanner-agent-tests/Program.cs
scanner-agent-tests/ScannerAgent.Tests.csproj
scanner-agent/AgentContext.cs
scanner-agent/AgentLog.cs
scanner-agent/ApiClient.cs
scanner-agent/BarcodePolicy.cs
scanner-agent/Models.cs
scanner-agent/README.md
scanner-agent/RawInput.cs
scanner-agent/RecoveryPolicy.cs
scanner-agent/ScanQueue.cs
scanner-agent/ScannerAgent.csproj
scanner-agent/Storage.cs
scanner-agent/WorkerForm.cs
src/app/api/scanner-agent/scan/route.ts
src/app/api/scanner-agent/shift/route.ts
src/lib/agent-errors.ts
src/lib/barcode.ts
supabase/diagnostics/scanner_reliability_preflight.sql
supabase/migrations/20260928_scanner_reliability.sql
tests/fixtures/barcodes.json
tests/scanner-agent.cjs
tests/scanner-employee.cjs
tests/scanner-reliability.cjs
```

Игнорируемые build/test outputs: `.next`, TypeScript cache, `scanner-agent/bin`, `scanner-agent/obj`, `scanner-agent-tests/bin`, `scanner-agent-tests/obj`, `scanner-agent-tests/artifacts`; временные PostgreSQL clusters/logs находятся в OS temp. `.env.local` не редактировался, секреты в отчёт не копировались.

## D–F. Migration, EXE и backend-only

- Migration: `20260928_scanner_reliability.sql`. Требует существующую global uniqueness migration 20260915. Не запускать историческую cooldown migration отдельно для ремонта.
- Новый EXE нужен для UI, reconnect, durable local receipts, улучшенного feedback и reconciliation. Версия 1.3.0; локальный файл: `scanner-agent/bin/Release/net8.0-windows/win-x64/publish/ScannerAgent.exe`.
- SHA256: `3B7F28230F2828F27965A7962BF96DBBF7ACDB83DE036CF25CDF52FFE6143722`.
- Backend/DB-only: actual readiness, классификация HTTP/DB ошибок, серверные receipts и повтор business result, транзакционные shift RPC и блокировки, normalization SQL/backend, совместимый wrapper старого RPC. Для них EXE сам по себе не обязателен, но старый EXE не предоставляет новые клиентские гарантии.

## G. Выполненные тесты

| Проверка | Результат |
| --- | --- |
| `npm.cmd run typecheck` | PASS |
| `npm.cmd run build` | PASS, Next.js production build |
| `npm.cmd run test:scanner` | PASS: scan/employee routes, global barcode и PGlite schema/regression |
| `npm.cmd run test:scanner:postgres` | PASS: отдельный локальный PostgreSQL, реальные параллельные соединения |
| `node tests/employee-session.cjs` | PASS |
| `node tests/order-search.cjs` | PASS |
| `dotnet build scanner-agent/ScannerAgent.csproj -c Release` | PASS |
| `dotnet build scanner-agent-tests/ScannerAgent.Tests.csproj -c Release` | PASS |
| `dotnet --roll-forward Major scanner-agent-tests/bin/Release/net8.0-windows/ScannerAgent.Tests.dll` | PASS |
| `dotnet publish scanner-agent/ScannerAgent.csproj -c Release -p:PublishProfile=win-x64` | PASS, только локальный каталог |
| `git diff --check` | PASS |

PostgreSQL: Наташа X counted → Артём X duplicate; одновременный одинаковый код у разных сотрудников даёт ровно counted + duplicate; одновременный один eventId возвращает одинаковый receipt. Проверены parallel start и оба принудительных порядка scan/finish, откат транзакции при сбое pause, read-only readiness, missing column/RPC, normalization и разные коды через 1 секунду.

C#: реальный DPAPI, legacy queue migration, дочерний процесс повторно читает два события, серверные business receipts, сохранение pending при HTTP failures и неверном eventId ACK, retry schedule/reset, timeout reconciliation всех четырёх действий, decoder/неоконченный пакет, UI Checking/busy/pending, binding resolve/unplug/replug/ambiguity и employee switch.

## H. Ограничения и не выполненные проверки

- Физического USB-сканера и двух рабочих ноутбуков в этом прогоне нет. Native hot unplug/replug, фокус окон, реальная скорость HID и полный GUI restart/login проверяются на пилоте. Автотест restart проверяет storage в новом процессе, не полную GUI-сессию.
- Timeout действий проверен HTTP simulation + чтением статуса; реальные задержки сети до/после commit на пилоте ещё не проверены.
- Production schema/history/deployed commit не читались и SQL туда не отправлялся; preflight остаётся обязательным.
- Первый запуск DPAPI/PostgreSQL внутри sandbox не прошёл из-за Windows profile/restricted token. Повтор вне sandbox прошёл. Один промежуточный C# build был заблокирован зависшим после сбоя тестовым процессом; после завершения этого процесса build и tests прошли.
- .NET SDK в окружении preview 10.0.300; target net8.0-windows. NU1900: недоступен NuGet vulnerability feed; сборка/publish успешны, онлайн-аудит NuGet не выполнен.

## I. Перед production rollout

После отдельного подтверждения: сделать проверяемый backup DB и сохранить migration history, текущие RPC/ACL, generated expression и indexes; выполнить `supabase/diagnostics/scanner_reliability_preflight.sql` и `global_barcode_audit.sql`. Сверить schema drift, duplicate open shifts/pauses, service_role privileges, настройки цены/timezone, токен и backend URL без публикации секретов. Проверить версии старых EXE/backend, состояние pending и возможность восстановления исходных Windows-профилей (DPAPI привязан к профилю/машине). Backup без проверки восстановления недостаточен.

## J. Безопасный rollout — только после подтверждения

1. **DB.** Остановить сканирование и действия смен на всех клиентах, синхронизировать pending либо сохранить исходные профили и очередь. Снять backup и preflight. Применить только проверенную `20260928_scanner_reliability.sql` штатным migration runner. При lock timeout/schema mismatch остановиться, не удалять данные ради прохождения migration. Проверить read-only readiness под service_role, receipts/operations tables и global unique index. Трафик пока закрыт: старый backend имеет нетранзакционные действия смен.
2. **Backend.** Сохранить предыдущий deployment ID и env configuration. Развернуть именно проверенный commit после успешной DB. Проверить 401 на неверный token, 200 readiness на правильный, не-Ready при DB/schema failure, структурированный ACK на business result. Проверить разрешённые тестовые коды/сотрудника, replay одного eventId и отсутствие cooldown. До успешных проверок сканирование не возобновлять.
3. **Test laptop.** Сохранить старый EXE и оба каталога `%ProgramData%\WarehouseScanner` / `%LocalAppData%\WarehouseScannerAgent` в исходном профиле. Закрыть агент, поставить локально проверенный EXE с указанным SHA256, запустить под прежним Windows-пользователем. Проверить все четыре индикатора; numeric/P/p/нули/внутренний пробел; два различных кода через 1 секунду; duplicate; отключение сети → local pending → полный restart → reconnect/drain; timeout start/pause/resume/finish; pending-switch block и switch после drain; USB unplug/replug без переопределения binding. Сверить каждый результат с receipt/DB. Не переходить дальше при расхождении.
4. **Второй laptop.** Сохранить те же backups, заменить EXE только после успешного пилота. Наташа X → counted, Артём X → duplicate; затем новый X одновременно → один counted, один duplicate. Проверить cold idle/reconnect и отсутствие роста pending после восстановления. Остальные ноутбуки — отдельный следующий этап.

## K. Rollback по этапам

| Этап | Точные действия при отказе |
| --- | --- |
| DB, migration не завершилась | Сохранить ошибку, убедиться в transaction rollback; оставить трафик остановленным, проверить старую схему/readiness. Не продолжать backend rollout. |
| DB завершилась, backend ещё не обновлён | Оставить новые additive tables/functions и receipts. Трафик остановлен до forward fix/нового backend. Если нужен полный возврат и после backup строго не было записей, восстановить backup в отдельную DB, проверить и переключить подключение по отдельному решению. Не делать DROP receipts/index и не возвращать старый writer поверх новых данных. |
| Backend обновлён | Остановить scan/shift traffic; сохранить deployment ID, логи/event IDs и очередь. Вернуть предыдущий backend deployment для диагностики только при закрытом трафике; DB оставить. Возобновление со старым нетранзакционным shift backend не допускается без отдельной проверки совместимости/исправления. Предпочтителен forward fix. |
| Test laptop | Остановить именно агент пилота, сохранить актуальные pending/receipts/session и логи. Сначала синхронизировать новым исправленным агентом либо держать очередь нетронутой. Вернуть сохранённый EXE только после проверки его чтения текущего формата; иначе оставить ноутбук выведенным из работы. Не восстанавливать старую копию очереди поверх новых данных и не менять Windows-профиль. Backend/DB оставить. |
| Второй laptop | Остановить rollout и агент второго ноутбука, сохранить его актуальные данные; выполнить тот же клиентский rollback. Пилот может работать только если проблема локальна и инварианты проверены; при общей ошибке остановить оба. Не повторять вручную уже подтверждённые события с новыми eventId. |

После любых новых production-записей простой restore старого DB backup теряет данные: нужен отдельный план reconciliation/PITR, а не автоматический откат. Это условие запрета опасного rollback, а не выполненная операция.

**Остановлено до deploy. Ожидается подтверждение пользователя.**
