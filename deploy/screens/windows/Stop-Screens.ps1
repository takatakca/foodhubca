<#
.SYNOPSIS
  Food Hub order screens on a Windows PC: stop the watchdog, the agents and the Chrome windows. PowerShell 5.1, no admin.
.DESCRIPTION
  Stops Start-Screens.ps1 (the watchdog), every agent (node agent.mjs --screen <id>) and every Chrome window of the
  installed screens (asked to close first, so the session is saved; forced after 10 s). Profiles stay on disk: the
  sign-ins survive. With -Unregister the Scheduled Task "FoodHub Screens" (or the Startup .cmd) is removed too, so
  nothing starts at the next sign-in.
.PARAMETER Root        Where Install-Screens.ps1 wrote the configs (default %LOCALAPPDATA%\FoodHubScreens).
.PARAMETER ScreensFile Use this list instead of the installed configs (with -DryRun).
.PARAMETER Unregister  Also remove the start-at-sign-in task.
.PARAMETER DryRun      Print what would be stopped, stop nothing.
.EXAMPLE
  .\Stop-Screens.ps1 -DryRun -ScreensFile ..\screens.example.json
.EXAMPLE
  .\Stop-Screens.ps1 -Unregister
#>
[CmdletBinding()]
param(
  [string]$Root,
  [string]$ScreensFile,
  [switch]$Unregister,
  [switch]$DryRun
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
$tag = $(if ($DryRun) { 'WOULD STOP' } else { 'STOP' })

# 1. The watchdog first, so it does not restart what is stopped next.
$watch = Get-RunningWatchdog $root
if ($watch -gt 0) {
  Write-Host ("$tag watchdog   Start-Screens.ps1 pid " + $watch)
  if (-not $DryRun) {
    Stop-Process -Id $watch -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
    Remove-Item -LiteralPath (Get-WatchdogFile $root) -Force -ErrorAction SilentlyContinue
  }
} else { Write-Host 'watchdog not running' }

# 2. Agents, then browsers.
$procs = @(Get-RelayProcesses)
$stopped = 0
foreach ($s in $screens) {
  $id = [string]$s.id
  $a = Find-AgentProcess -Processes $procs -Id $id
  if ($null -ne $a) {
    Write-Host ("$tag agent      " + $id + " pid " + $a.ProcessId)
    if (-not $DryRun) { Stop-Process -Id $a.ProcessId -Force -ErrorAction SilentlyContinue; Write-ScreenLog $s.logPath ('agent stopped by Stop-Screens.ps1 pid=' + $a.ProcessId); $stopped++ }
  }
  $b = Find-BrowserProcess -Processes $procs -ProfileDir ([string]$s.profileDir)
  if ($null -ne $b) {
    Write-Host ("$tag browser    " + $id + " pid " + $b.ProcessId + " (" + $b.Name + ")")
    if (-not $DryRun) { $how = Stop-ProcessGracefully -ProcessId ([int]$b.ProcessId) -TimeoutSeconds 10; Write-ScreenLog $s.logPath ('browser ' + $how + ' by Stop-Screens.ps1 pid=' + $b.ProcessId); $stopped++ }
  }
  if ($null -eq $a -and $null -eq $b) { Write-Host ("nothing running  " + $id) }
}

# 3. Start at sign-in.
if ($Unregister) {
  $removed = @(Unregister-StartupTask -DryRun:$DryRun)
  if ($removed.Count -eq 0) { Write-Host 'start at sign-in: nothing to remove' }
  foreach ($r in $removed) { Write-Host ("$tag startup    " + $r) }
} else {
  Write-Host ('start at sign-in: ' + (Get-StartupTaskState) + '  (add -Unregister to remove it)')
}

if ($DryRun) { Write-Host 'Dry run: nothing was stopped.' }
else { Write-Host ("Stopped " + $stopped + " process(es). Profiles kept under " + $root + " (the sign-ins survive).") }
exit 0
