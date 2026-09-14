# ScannerAgent v1.2.0

Windows x64, .NET 8/WinForms, self-contained single-file EXE. В рабочем окне — показатели, смена и «Сменить сотрудника». PIN вводится отдельно. URL, token и HID доступны в tray → «Расширенные настройки» с подтверждением.

## Причины проблем и изменения

В v1.1.2 Validate сравнивал только полный Windows device path. Не было RIDEV_DEVNOTIFY / WM_INPUT_DEVICE_CHANGE и повторного поиска. Теперь сохраняются VID/PID, UsagePage/Usage, serial (если доступен), HID collection, product/manufacturer. При запуске, hotplug и раз в 3 секунды определяется текущий path. Для Raw Input keyboard collection UsagePage=1, Usage=6.

Два одинаковых устройства без serial одновременно не выбираются случайно: VID/PID не доказывает уникальность физического экземпляра. Оставьте подключённым один рабочий сканер.

Hotplug реализован по [документации Microsoft](https://learn.microsoft.com/en-us/windows/win32/inputdev/wm-input-device-change).

Раньше статус связи зависел от тяжёлого shift-запроса (PIN/bcrypt, несколько запросов к базе) с timeout 30 секунд. Теперь health имеет отдельный timeout 3 секунды, повторы 2/5/10/15 секунд, работает независимо от отправки очереди.

В агенте и backend были цифровые проверки. Теперь допустимы numeric (8–512 цифр) и латинская P + 8–511 цифр. Whitespace удаляются, p → P, ведущие нули сохраняются. ABC123, TEST123, кириллическая Р и произвольные буквы отклоняются. Barcode в SQL уже text; новую миграцию не добавляли.

HTTP 500/429/401/403 больше не удаляют offline-событие. Повреждённый ответ не считается подтверждением. Ошибка Supabase при чтении сотрудника/смены/показателей возвращает 503 вместо ложного отсутствия сотрудника/смены.

## Хранение

| Данные | Место |
|---|---|
| Общие URL и fingerprint | %PROGRAMDATA%\WarehouseScanner\config.json |
| API token | %PROGRAMDATA%\WarehouseScanner\api-token.dpapi — DPAPI LocalMachine |
| UUID, имя, role, permissions и смена последнего сотрудника | %LOCALAPPDATA%\WarehouseScannerAgent\employee-session.dpapi — DPAPI CurrentUser |
| Offline queue | %LOCALAPPDATA%\WarehouseScannerAgent\pending-scans.dpapi — DPAPI CurrentUser |
| Лог | %LOCALAPPDATA%\WarehouseScanner\logs\scanner-agent.log |

PIN не сохраняется после входа и не пишется в логи/URL. Resolve передаёт PIN только в HTTPS POST body, возвращает UUID. Последующие операции используют UUID. Backend продолжает проверять token и active; новый PIN resolve также требует picking permission. Кэш не создаёт офлайн-смены: без сети сканирование возможно только с ранее подтверждённой активной сменой. Отключённому сотруднику сервер не засчитает события.

Очередь остаётся в исходном Windows-профиле. Смена PIN сохраняет владельца, shift_id, event_id и scanned_at уже накопленных событий. Очередь другого Windows-профиля синхронизируется при запуске агента в том профиле. Не удаляйте профиль с неотправленными заказами.

Перед паузой/завершением смены нужно отправить её очередь. Смена сотрудника предупреждает об открытой смене, не завершает её. Выход из приложения также не завершает смену.

DPAPI LocalMachine предназначен для доверенных пользователей ноутбука и не изолирует token от локального администратора. DPAPI-файлы нельзя переносить между компьютерами.

## Однократная установка

1. Сначала разверните backend: новые employee/health endpoints, валидацию scan и обработку ошибок shift. SQL migration не требуется.
2. По возможности синхронизируйте старую очередь. Закройте старый агент через tray → «Выход».
3. Скопируйте EXE и install.ps1 на ноутбук. В PowerShell от администратора:

~~~powershell
powershell.exe -ExecutionPolicy Bypass -File .\install.ps1 -SourceExe .\ScannerAgent.exe
~~~

Скрипт устанавливает EXE в %ProgramFiles%\WarehouseScanner\ScannerAgent.exe, создаёт общий ярлык и даёт Windows Users запись в общий каталог настроек. Настройки и очереди не удаляются.

4. Запустите ярлык обычным пользователем в исходном Windows-профиле старого агента. Переносятся URL, token из Credential Manager и fingerprint из старого scanner path. Старый PIN не переносится; сотрудник входит один раз.
5. На новом ноутбуке настройщик один раз открывает расширенные настройки, вводит URL и token. HID можно не выбирать: сохраните и пикните тестовый код по приглашению «Первичная настройка сканера».
6. Тестовый код не отправляется на backend. Дождитесь «Сканер настроен» / «Готов».
7. Сотрудник вводит PIN, видит имя, нажимает «Начать смену». Следующий сотрудник меняет только PIN. Другой Windows-профиль использует те же URL/token/fingerprint.

Если старые настройки есть только в чужом Windows-профиле, запустите v1.2.0 там один раз: Credential Manager другого пользователя автоматически расшифровать нельзя.

## Сборка

Из корня репозитория:

~~~powershell
dotnet build scanner-agent/ScannerAgent.csproj -c Release
dotnet publish scanner-agent/ScannerAgent.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:DebugType=None -p:DebugSymbols=false -o scanner-agent/publish/win-x64
npm.cmd run typecheck
npm.cmd run build
~~~

EXE: scanner-agent/publish/win-x64/ScannerAgent.exe. .NET на рабочем ноутбуке не нужен. Настройки в EXE не встраиваются.

## Проверки

~~~powershell
dotnet build scanner-agent-tests/ScannerAgent.Tests.csproj -c Release
dotnet --roll-forward Major scanner-agent-tests/bin/Release/net8.0-windows/ScannerAgent.Tests.dll
node tests/scanner-agent.cjs
~~~

.NET-тесты проверяют настоящие DPAPI и дисковую очередь в scanner-agent-tests/artifacts. HTTP и устройства моделируются. Production backend не используется. Нужен доступ к обычному Windows-профилю DPAPI; ограниченная песочница может его запрещать.

| Сценарий | Автоматическая проверка | Приёмка на ноутбуке |
|---|---|---|
| A. Запуск → Ready | Fingerprint resolver | Запустить с подключённым сканером |
| B. Артём → PIN Даши | Владелец событий очереди сохраняется | Проверить Ready и новое имя |
| C. USB вынуть/вставить | Отсутствие/возврат fingerprint | Проверить статусы без restart |
| D. Offline 2 заказа → sync | Диск, restart, retry, исходное время | Отключить сеть при активной смене, пикнуть 2 разных кода, включить сеть |
| E. Avito numeric | Валидация агента/backend | Новый numeric → counted |
| F. Почта/СДЭК numeric | Валидация агента/backend | Новый numeric → counted |
| G. P00119280697 | Полный код в POST/RPC | Новый Yandex → counted |
| H. ABC123 | Агент/backend отклоняют | Отказ без создания заказа |
| I. Перезапуск | Перечитывание очереди, resolver | Проверить Ready и прежнюю смену |
| J. Изменённый path | Новый path при прежнем fingerprint | Сменить USB-порт, проверить Ready |

Физическая приёмка A–J и counted на рабочем Supabase здесь не выполнены: складского сканера и production-подключения нет. Для counted берите новый barcode и соблюдайте серверный cooldown, иначе штатно получится duplicate/too_fast. Проверьте также завершение смены после синхронизации и прежние заработок/медиану в админке.