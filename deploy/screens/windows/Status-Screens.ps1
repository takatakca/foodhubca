<#
.SYNOPSIS
  Food Hub order screens on a Windows PC: what runs. PowerShell 5.1, no admin, read-only.
.DESCRIPTION
  One line per installed screen: Chrome pid, agent pid, debugging port (and whether it answers), last log line.
  Plus the watchdog pid and the start-at-sign-in task state. Never shows a value from .env.
.PARAMETER Root        Where Install-Screens.ps1 wrote the configs (default %LOCALAPPDATA%\FoodHubScreens).
.PARAMETER ScreensFile Use this list instead of the installed configs (before an install).
.PARAMETER AsJson      Print as JSON.
.EXAMPLE
  .\Status-Screens.ps1
#>
[CmdletBinding()]
param(
  [string]$Root,
  [string]$ScreensFile,
  [switch]$AsJson
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Screens-Common.ps1')

$root = Get-ScreensRoot $Root
$screens = @()
if ($ScreensFile) {
  $list = Read-ScreensList (Resolve-KitFile 'screens.json' $ScreensFile)
  if ($list.errors.Count -gt 0) { Write-Host ("The list is refused:`n" + (($list.errors | ForEach-Object { '  - ' + $_ }) -join "`n")) -ForegroundColor Red; exit 1 }
  $mon = Get-MonitorSize ''
  $screens = @(New-ScreensPlan -Screens $list.screens -Root $root -PortBase $script:DefaultPortBase -MonitorWidth $mon.width -MonitorHeight $mon.height)
} else {
  $screens = @(Get-ScreenConfigs $root)
}

$procs = @(Get-RelayProcesses)
$watch = Get-RunningWatchdog $root
$taskState = Get-StartupTaskState
$envPath = Resolve-KitFile '.env' ''
$kitFile = Join-Path $root 'kit.json'
if (Test-Path -LiteralPath $kitFile -PathType Leaf) { try { $k = Read-JsonFile $kitFile; if (Get-Prop $k 'envFile') { $envPath = [string]$k.envFile } } catch { } }
$dotenv = Read-DotEnv $envPath
$envMissing = @()
foreach ($name in $script:RequiredEnv) { if ((Get-EnvValue $dotenv $name) -eq '') { $envMissing += $name } }

$rows = @()
foreach ($s in $screens) {
  $b = Find-BrowserProcess -Processes $procs -ProfileDir ([string]$s.profileDir)
  $a = Find-AgentProcess -Processes $procs -Id ([string]$s.id)
  $port = [int]$s.port
  $rows += [ordered]@{
    id = [string]$s.id; name = [string]$s.name; platform = [string]$s.platform
    port = $port; portOpen = (Test-LocalPort $port)
    browserPid = $(if ($null -ne $b) { [int]$b.ProcessId } else { 0 })
    browser = $(if ($null -ne $b) { [string]$b.Name } else { '' })
    agentPid = $(if ($null -ne $a) { [int]$a.ProcessId } else { 0 })
    lastLog = (Get-LastLogLine ([string]$s.logPath))
    logPath = [string]$s.logPath
  }
}

$summary = [ordered]@{
  root = $root; installed = (Test-Path -LiteralPath $kitFile -PathType Leaf)
  watchdogPid = $watch; startAtSignIn = $taskState
  envFile = $envPath; envMissing = @($envMissing)
  screens = @($rows)
}

if ($AsJson) { Write-Output (ConvertTo-Json -InputObject $summary -Depth 6); exit 0 }

Write-Host ("Food Hub order screens - " + $root + $(if ($summary.installed) { '' } else { '  (not installed: run Install-Screens.ps1)' }))
Write-Host ("  watchdog        : " + $(if ($watch -gt 0) { 'running pid ' + $watch } else { 'NOT running (Start-Screens.ps1)' }))
Write-Host ("  start at sign-in: " + $taskState)
Write-Host ("  .env            : " + $envPath + $(if ($envMissing.Count -gt 0) { '  missing ' + ($envMissing -join ', ') } else { '  ok' }))
if ($rows.Count -eq 0) { Write-Host '  no screen'; exit 0 }
Write-Host ''
Write-Host ('  ' + 'id'.PadRight(24) + 'port'.PadRight(7) + 'chrome'.PadRight(10) + 'agent'.PadRight(10) + 'name')
foreach ($r in $rows) {
  $chrome = $(if ($r.browserPid -gt 0) { [string]$r.browserPid } else { 'down' })
  $agent = $(if ($r.agentPid -gt 0) { [string]$r.agentPid } else { 'down' })
  $portText = [string]$r.port + $(if ($r.portOpen) { '' } else { '!' })
  Write-Host ('  ' + $r.id.PadRight(24) + $portText.PadRight(7) + $chrome.PadRight(10) + $agent.PadRight(10) + $r.name)
  if ($r.lastLog -ne '') { Write-Host ('  ' + ''.PadRight(24) + 'log: ' + $r.lastLog) }
}
Write-Host ''
Write-Host ('  port! = Chrome does not answer on its debugging port yet.  Logs: ' + (Join-Path $root 'logs'))
exit 0
