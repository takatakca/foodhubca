<#
.SYNOPSIS
  Food Hub order screens on a Windows PC: start every screen and watch it. PowerShell 5.1, no admin.
.DESCRIPTION
  For each screen installed by Install-Screens.ps1: starts Chrome (or Edge) with its own profile folder and debugging
  port, on its own window, then starts `node agent.mjs` for it with the values from .env (FOODHUB_URL,
  FOODHUB_SCREENS_AGENT_TOKEN, HEARTBEAT_SECONDS) plus the screen's values (SCREEN_ID, SCREEN_START_URL, CDP_URL).
  Then it stays as a watchdog: every 30 s, a Chrome window that is gone is restarted, an agent that is gone is
  restarted. Everything is logged to %LOCALAPPDATA%\FoodHubScreens\logs\<id>.log (rotated at 5 MB).
  It never signs in anywhere: the owner signs in once inside each Chrome window. No value from .env is ever logged.
  The Scheduled Task "FoodHub Screens" runs this script at sign-in; it can also be run by hand. Only one instance runs
  per PC: a second one exits at once.
.PARAMETER Root            Where Install-Screens.ps1 wrote the configs (default %LOCALAPPDATA%\FoodHubScreens).
.PARAMETER ScreensFile     Plan from this list instead of the installed configs (with -DryRun: nothing to install first).
.PARAMETER IntervalSeconds Watchdog period (default 30).
.PARAMETER Once            One pass (start what is missing), then exit: no watchdog loop.
.PARAMETER DryRun          Print what would be started, start nothing, write nothing.
.EXAMPLE
  .\Start-Screens.ps1 -DryRun -ScreensFile ..\screens.example.json
.EXAMPLE
  .\Start-Screens.ps1
#>
[CmdletBinding()]
param(
  [string]$Root,
  [string]$ScreensFile,
  [int]$IntervalSeconds = 30,
  [switch]$Once,
  [switch]$DryRun
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Screens-Common.ps1')

if ($IntervalSeconds -lt 5) { $IntervalSeconds = 5 }
$root = Get-ScreensRoot $Root
$kit = $null
$kitFile = Join-Path $root 'kit.json'
if (Test-Path -LiteralPath $kitFile -PathType Leaf) { try { $kit = Read-JsonFile $kitFile } catch { $kit = $null } }
$envPath = Resolve-KitFile '.env' $(if ($null -ne $kit) { [string](Get-Prop $kit 'envFile') } else { '' })
$agentDir = $(if ($null -ne $kit -and (Get-Prop $kit 'agentDir')) { [string]$kit.agentDir } else { Get-AgentDir })
$agentScript = Join-Path $agentDir 'agent.mjs'

# The screens: installed configs, or a plan from a list (-ScreensFile).
$screens = @()
if ($ScreensFile) {
  $list = Read-ScreensList (Resolve-KitFile 'screens.json' $ScreensFile)
  if ($list.errors.Count -gt 0) { Write-Host ("The list is refused:`n" + (($list.errors | ForEach-Object { '  - ' + $_ }) -join "`n")) -ForegroundColor Red; exit 1 }
  foreach ($a in @($list.skipped)) { Write-Host ("SKIP  " + $a.id + " (android): " + $a.reason) }
  $mon = Get-MonitorSize $(if ($null -ne $kit) { [string](Get-Prop $kit 'monitor') } else { '' })
  $portBase = $script:DefaultPortBase
  if ($null -ne $kit -and (Get-Prop $kit 'portBase')) { $portBase = [int]$kit.portBase }
  foreach ($p in @(New-ScreensPlan -Screens $list.screens -Root $root -PortBase $portBase -MonitorWidth $mon.width -MonitorHeight $mon.height)) {
    $p.cdpUrl = 'http://127.0.0.1:' + $p.port
    $screens += $p
  }
} else {
  $wanted = $null
  if ($null -ne $kit) { $wanted = @(Get-Prop $kit 'ids') }
  foreach ($c in @(Get-ScreenConfigs $root)) {
    if ($null -ne $wanted -and $wanted.Count -gt 0 -and ($wanted -notcontains $c.id)) { continue }
    $screens += $c
  }
}
if ($screens.Count -eq 0) {
  Write-Host ("No screen installed under " + $root + ". Run Install-Screens.ps1 first (or -DryRun -ScreensFile ..\screens.example.json).") -ForegroundColor Yellow
  exit 1
}

# One watchdog per PC.
$other = Get-RunningWatchdog $root
if ($other -gt 0 -and $other -ne $PID) {
  Write-Host ("Start-Screens.ps1 is already running (pid " + $other + "). Use Status-Screens.ps1, or Stop-Screens.ps1 first.")
  exit 0
}

$browser = Find-Browser
$node = Find-NodeExe
if (-not $DryRun) {
  if (-not $browser) { Write-Error 'No Google Chrome or Microsoft Edge found. Install one, then run again.'; exit 2 }
  if (-not $node) { Write-Error 'node.exe not found. Install Node 22 LTS (nodejs.org), then run again.'; exit 2 }
  if (-not (Test-Path -LiteralPath $agentScript -PathType Leaf)) { Write-Error ("Agent not found: " + $agentScript); exit 2 }
  New-Item -ItemType Directory -Path (Join-Path $root 'logs') -Force | Out-Null
  Write-JsonFile -Path (Get-WatchdogFile $root) -Object ([ordered]@{ pid = $PID; startedAt = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK'); root = $root; interval = $IntervalSeconds })
}

function Get-AgentEnvironment {
  # Values for one agent: from .env (re-read every pass, so the owner can fill it after the start) + the screen.
  # Returns $null (with the missing names) while .env is incomplete. Never logged, never printed.
  param($Screen)
  $dotenv = Read-DotEnv $envPath
  $missing = @()
  foreach ($name in $script:RequiredEnv) { if ((Get-EnvValue $dotenv $name) -eq '') { $missing += $name } }
  if ($missing.Count -gt 0) { return @{ env = $null; missing = $missing } }
  $screenId = Get-EnvValue $dotenv $Screen.envVar
  if ($screenId -eq '') { $screenId = [string]$Screen.id }
  $e = @{
    FOODHUB_URL = (Get-EnvValue $dotenv 'FOODHUB_URL')
    FOODHUB_SCREENS_AGENT_TOKEN = (Get-EnvValue $dotenv 'FOODHUB_SCREENS_AGENT_TOKEN')
    SCREEN_ID = $screenId
    SCREEN_START_URL = [string]$Screen.startUrl
    CDP_URL = ('http://127.0.0.1:' + $Screen.port)
    NODE_NO_WARNINGS = '1'
  }
  $hb = Get-EnvValue $dotenv 'HEARTBEAT_SECONDS'
  if ($hb -ne '') { $e.HEARTBEAT_SECONDS = $hb }
  return @{ env = $e; missing = @() }
}

function Get-BrowserArguments {
  param($Screen)
  $profileDir = [string]$Screen.profileDir
  $argList = @(
    ('--user-data-dir=' + $profileDir),
    ('--remote-debugging-port=' + $Screen.port),
    '--no-first-run', '--no-default-browser-check',
    '--disable-session-crashed-bubble', '--restore-last-session',
    '--disable-features=TranslateUI',
    ('--window-position=' + $Screen.window.x + ',' + $Screen.window.y),
    ('--window-size=' + $Screen.window.width + ',' + $Screen.window.height)
  )
  # First start of this profile: open the order page. Later starts restore the last session (the same page, still
  # signed in) and would otherwise add one more tab each time; if the session comes back empty, the agent opens the
  # start page itself.
  $hasSession = Test-Path -LiteralPath (Join-Path $profileDir 'Default\Sessions') -PathType Container
  if (-not $hasSession) { $argList += @('--new-window', [string]$Screen.startUrl) }
  return $argList
}

# Running children started here: id -> @{ agent = Process; out = Task; err = Task }
$children = @{}

function Read-AgentOutput {
  # Copy the agent's stdout/stderr lines into the screen log without blocking (ReadLineAsync, polled).
  param([string]$Id, $Screen)
  if (-not $children.ContainsKey($Id)) { return }
  $c = $children[$Id]
  $proc = $c.agent
  foreach ($w in @('out', 'err')) {
    $reader = $null
    if ($w -eq 'out') { $reader = $proc.StandardOutput } else { $reader = $proc.StandardError }
    $guard = 0
    while ($null -ne $c[$w] -and $c[$w].IsCompleted -and $guard -lt 200) {
      $guard++
      $line = $null
      if ($c[$w].Status -eq 'RanToCompletion') { $line = $c[$w].Result }
      if ($null -eq $line) { $c[$w] = $null; break }
      if ($line -ne '') { Write-ScreenLog $Screen.logPath ('agent: ' + $line) }
      $c[$w] = $reader.ReadLineAsync()
    }
  }
}

function Start-ScreenBrowser {
  param($Screen)
  $argList = @(Get-BrowserArguments $Screen)
  if ($DryRun) { Write-Host ("WOULD START browser  " + $Screen.id + ": " + $browser + " " + ($argList -join ' ')); return $null }
  New-Item -ItemType Directory -Path $Screen.profileDir -Force | Out-Null
  $p = Start-ChildProcess -FilePath $browser -ArgumentList $argList
  Write-ScreenLog $Screen.logPath ('browser started pid=' + $p.Id + ' port=' + $Screen.port + ' exe=' + $browser)
  return $p
}

function Start-ScreenAgent {
  param($Screen)
  $r = Get-AgentEnvironment $Screen
  $argList = @($agentScript, '--screen', [string]$Screen.id)
  if ($DryRun) {
    $names = @()
    if ($null -ne $r.env) { $names = @($r.env.Keys | Sort-Object) }
    Write-Host ("WOULD START agent    " + $Screen.id + ": " + $(if ($node) { $node } else { 'node.exe' }) + " " + ($argList -join ' ') + "  (env: " + ($names -join ', ') + $(if ($r.missing.Count -gt 0) { '; .env missing ' + ($r.missing -join ', ') } else { '' }) + ")")
    return
  }
  if ($null -eq $r.env) {
    Write-ScreenLog $Screen.logPath ('agent not started: .env is missing ' + ($r.missing -join ', ') + ' (' + $envPath + ')')
    return
  }
  $p = Start-ChildProcess -FilePath $node -ArgumentList $argList -Environment $r.env -WorkingDirectory $agentDir -CaptureOutput
  $children[[string]$Screen.id] = @{ agent = $p; out = $p.StandardOutput.ReadLineAsync(); err = $p.StandardError.ReadLineAsync() }
  Write-ScreenLog $Screen.logPath ('agent started pid=' + $p.Id + ' cdp=' + $r.env.CDP_URL)
}

function Invoke-WatchdogPass {
  param([bool]$First)
  $procs = @(Get-RelayProcesses)
  foreach ($s in $screens) {
    $id = [string]$s.id
    # Browser: adopt a window already open on this profile, else start one.
    $b = Find-BrowserProcess -Processes $procs -ProfileDir ([string]$s.profileDir)
    if ($null -eq $b) {
      if (-not $First) { Write-ScreenLog $s.logPath 'browser gone: restarting' }
      [void](Start-ScreenBrowser $s)
    } elseif ($First -and -not $DryRun) { Write-ScreenLog $s.logPath ('browser already running pid=' + $b.ProcessId + ' (kept)') }
    # Agent: on the first pass an agent left by an earlier run is stopped and started again (its output is captured
    # by this run); afterwards an agent that is gone is restarted.
    if ($children.ContainsKey($id)) {
      Read-AgentOutput $id $s
      if ($children[$id].agent.HasExited) {
        Write-ScreenLog $s.logPath ('agent exited code=' + $children[$id].agent.ExitCode + ': restarting')
        $children.Remove($id)
        Start-ScreenAgent $s
      }
      continue
    }
    $a = Find-AgentProcess -Processes $procs -Id $id
    if ($null -ne $a) {
      if ($DryRun) { Write-Host ("agent already running   " + $id + " pid " + $a.ProcessId); continue }
      Write-ScreenLog $s.logPath ('agent pid=' + $a.ProcessId + ' from an earlier run: stopping it to start a fresh one')
      Stop-Process -Id $a.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-ScreenAgent $s
  }
}

Write-Host ("Food Hub order screens: " + $screens.Count + " screen(s), root " + $root + $(if ($DryRun) { '  (DRY RUN)' } else { '' }))
foreach ($s in $screens) { Write-Host ("  " + ([string]$s.id).PadRight(24) + " port " + $s.port + "  " + $s.name) }
Invoke-WatchdogPass -First $true
if ($DryRun -or $Once) {
  if ($DryRun) { Write-Host 'Dry run: nothing was started.' }
  else { Write-Host 'Started. Watchdog not running (-Once): a closed window will not be reopened.' }
  exit 0
}

Write-Host ("Watchdog running every " + $IntervalSeconds + " s. Logs: " + (Join-Path $root 'logs') + ". Stop with Stop-Screens.ps1.")
try {
  while ($true) {
    # Drain agent output more often than the restart check so the logs stay current.
    $slept = 0
    while ($slept -lt $IntervalSeconds) {
      Start-Sleep -Seconds 5
      $slept += 5
      foreach ($s in $screens) { Read-AgentOutput ([string]$s.id) $s }
    }
    try { Invoke-WatchdogPass -First $false } catch { foreach ($s in $screens) { Write-ScreenLog $s.logPath ('watchdog error: ' + $_.Exception.Message); break } }
  }
} finally {
  # The watchdog is leaving (Stop-Screens.ps1, closed console): the agents it started go with it; the windows stay.
  foreach ($id in @($children.Keys)) { try { if (-not $children[$id].agent.HasExited) { Stop-Process -Id $children[$id].agent.Id -Force -ErrorAction SilentlyContinue } } catch { } }
  try { Remove-Item -LiteralPath (Get-WatchdogFile $root) -Force -ErrorAction SilentlyContinue } catch { }
}
