# Warehouse Scanner Agent

Windows-приложение .NET 8/WinForms принимает ввод только от выбранного физического HID-устройства через Windows Raw Input. Оно не ставит глобальный keyboard hook и не требует фокуса сайта.

При первом запуске укажите HTTPS URL сайта, UUID сотрудника (предпочтительно) либо его PIN, `SCANNER_AGENT_API_TOKEN` и определите сканер. Конфигурация хранится в `%LOCALAPPDATA%\WarehouseScannerAgent`; токен — отдельно в Windows Credential Manager. Неуспевшие отправиться сетевые события лежат в локальной очереди с постоянным UUID `event_id`.

Сборка:

```powershell
dotnet publish .\scanner-agent\ScannerAgent.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true
```

Готовый файл: `scanner-agent\bin\Release\net8.0-windows\win-x64\publish\ScannerAgent.exe`.
