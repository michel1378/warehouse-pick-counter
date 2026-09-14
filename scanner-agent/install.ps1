# Run once from an elevated PowerShell, then run ScannerAgent normally as the worker.
# Existing configuration, encrypted token and per-user queues are preserved.
#Requires -RunAsAdministrator
param([string]$SourceExe = (Join-Path $PSScriptRoot 'publish\win-x64\ScannerAgent.exe'))
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $SourceExe -PathType Leaf)) { throw "ScannerAgent.exe not found: $SourceExe" }
$installDirectory = Join-Path $env:ProgramFiles 'WarehouseScanner'
$machineDirectory = Join-Path $env:ProgramData 'WarehouseScanner'
New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $machineDirectory -Force | Out-Null
# All trusted warehouse profiles can persist the machine fingerprint and DPAPI token.
# Executables stay in Program Files, writable only by administrators.
$machineAcl = Get-Acl -LiteralPath $machineDirectory
$usersSid = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-545')
$rule = [System.Security.AccessControl.FileSystemAccessRule]::new($usersSid, 'Modify', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
$machineAcl.SetAccessRule($rule)
Set-Acl -LiteralPath $machineDirectory -AclObject $machineAcl
$destination = Join-Path $installDirectory 'ScannerAgent.exe'
Copy-Item -LiteralPath $SourceExe -Destination $destination -Force
$shortcutPath = Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'ScannerAgent.lnk'
$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
$shortcut.TargetPath = $destination
$shortcut.WorkingDirectory = $installDirectory
$shortcut.Save()
Write-Output "Installed: $destination"
Write-Output 'Start as the original Windows user once to migrate the legacy configuration and queue.'
