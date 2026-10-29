<#
.SYNOPSIS
  Food Hub order screens on a Windows PC: install (run once). PowerShell 5.1, no admin.
.DESCRIPTION
  Reads screens.json (web screens only; Android screens are listed and skipped), refuses it if any entry carries a
  user name, a secret or a code (same rule as deploy/screens/generate.mjs), then for each screen:
    - a Chrome profile folder            %LOCALAPPDATA%\FoodHubScreens\<id>\profile
    - a unique debugging port            9222, 9223, ... (-PortBase to change)
    - a config without any secret        %LOCALAPPDATA%\FoodHubScreens\<id>\screen.json
  checks that .env (next to the scripts, or in deploy\screens\) names FOODHUB_URL and FOODHUB_SCREENS_AGENT_TOKEN,
  installs the agent's npm packages, registers the Scheduled Task "FoodHub Screens" (at sign-in of the current user,
  no admin; falls back to the Startup folder), and prints what it did. The token is never read into a config or a log.
.PARAMETER ScreensFile  The list (default: screens.json next to the scripts, else deploy\screens\screens.json).
.PARAMETER EnvFile      The .env file (default: next to the scripts, else deploy\screens\.env).
.PARAMETER Root         Where profiles, configs and logs live (default %LOCALAPPDATA%\FoodHubScreens).
.PARAMETER PortBase     First debugging port (default 9222).
.PARAMETER Monitor      Tile the windows for this size, e.g. 1920x1080 (default: the primary monitor).
.PARAMETER NoTask       Do not register the Scheduled Task.
.PARAMETER SkipNpm      Do not run npm install in deploy\screens\agent.
.PARAMETER DryRun       Print the plan, write nothing, register nothing, run nothing.
.PARAMETER AsJson       Print the plan as JSON (never contains a value from .env).
.EXAMPLE
  .\Install-Screens.ps1 -DryRun -ScreensFile ..\screens.example.json
.EXAMPLE
  .\Install-Screens.ps1
#>
[CmdletBinding()]
param(
  [string]$ScreensFile,
  [string]$EnvFile,
  [string]$Root,
  [int]$PortBase = 9222,
  [string]$Monitor,
  [switch]$NoTask,
  [switch]$SkipNpm,
  [switch]$DryRun,
  [switch]$AsJson
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Screens-Common.ps1')

$out = @()
function Say { param([string]$Line) $script:out += $Line; if (-not $AsJson) { Write-Host $Line } }

if ($PortBase -lt 1024 -or $PortBase -gt 65000) { Write-Error "PortBase must be between 1024 and 65000 (got $PortBase)."; exit 2 }

$root = Get-ScreensRoot $Root
$screensPath = Resolve-KitFile 'screens.json' $ScreensFile
$envPath = Resolve-KitFile '.env' $EnvFile
$agentDir = Get-AgentDir
$startScript = Join-Path $PSScriptRoot 'Start-Screens.ps1'

# 1. The list. Any error refuses the whole file.
$list = Read-ScreensList $screensPath
if ($list.errors.Count -gt 0) {
  $msg = "$screensPath is refused:`n" + (($list.errors | ForEach-Object { '  - ' + $_ }) -join "`n")
  if ($AsJson) { Write-Output (ConvertTo-Json -InputObject ([ordered]@{ ok = $false; screensFile = $screensPath; errors = @($list.errors) }) -Depth 4) }
  else { Write-Host $msg -ForegroundColor Red }
  exit 1
}
foreach ($a in @($list.skipped)) { Say ("SKIP  " + $a.id + " (" + $a.name + ", android): " + $a.reason) }
if (@($list.screens).Count -eq 0) {
  Say 'No web screen in the list: nothing to install.'
  if ($AsJson) { Write-Output (ConvertTo-Json -InputObject ([ordered]@{ ok = $false; screensFile = $screensPath; errors = @('no web screen in the list'); skipped = @($list.skipped) }) -Depth 6) }
  exit 1
}

# 2. The plan: ports, folders, windows.
$mon = Get-MonitorSize $Monitor
$plan = @(New-ScreensPlan -Screens $list.screens -Root $root -PortBase $PortBase -MonitorWidth $mon.width -MonitorHeight $mon.height)

# 3. .env: names only are checked; values are never shown.
$dotenv = Read-DotEnv $envPath
$envMissing = @()
foreach ($name in $script:RequiredEnv) { if ((Get-EnvValue $dotenv $name) -eq '') { $envMissing += $name } }
$idsWithoutEnv = @()
foreach ($p in $plan) { if ((Get-EnvValue $dotenv $p.envVar) -eq '') { $idsWithoutEnv += $p.envVar } }

# 4. Programs.
$browser = Find-Browser
$node = Find-NodeExe
$agentReady = Test-Path -LiteralPath (Join-Path $agentDir 'node_modules\playwright-core') -PathType Container

Say ("Food Hub order screens - Windows kit" + $(if ($DryRun) { ' (DRY RUN: nothing is written)' } else { '' }))
Say ("  list      : " + $screensPath)
Say ("  .env      : " + $envPath + $(if (Test-Path -LiteralPath $envPath -PathType Leaf) { '' } else { '  (missing: copy ..\.env.example to .env and fill it)' }))
Say ("  root      : " + $root)
Say ("  agent     : " + $agentDir + $(if ($agentReady) { '' } else { '  (npm packages not installed yet)' }))
Say ("  browser   : " + $(if ($browser) { $browser } else { 'NOT FOUND - install Google Chrome or Microsoft Edge' }))
Say ("  node      : " + $(if ($node) { $node } else { 'NOT FOUND - install Node 22 LTS from nodejs.org' }))
Say ("  monitor   : " + $mon.width + "x" + $mon.height + " (" + $mon.source + ")")
Say ''
foreach ($p in $plan) {
  Say ("  " + $p.id.PadRight(24) + " port " + $p.port + "  window " + $p.window.x + "," + $p.window.y + " " + $p.window.width + "x" + $p.window.height + "  " + $script:Platforms[$p.platform].label + " """ + $p.name + """")
  Say ("  " + ''.PadRight(24) + " " + $p.startUrl)
  Say ("  " + ''.PadRight(24) + " profile " + $p.profileDir)
}
Say ''
if ($envMissing.Count -gt 0) { Say ("WARN  .env is missing: " + ($envMissing -join ', ') + ". The Chrome windows will open, the agents will not report until it is filled.") }
if ($idsWithoutEnv.Count -gt 0) { Say ("NOTE  no " + ($idsWithoutEnv -join ', ') + " in .env: the id from the list is sent to Food Hub as is (fine for s01..s32 ids).") }

# 5. Do it.
$npmResult = 'skipped'
if (-not $DryRun) {
  foreach ($p in $plan) {
    New-Item -ItemType Directory -Path $p.profileDir -Force | Out-Null
    $config = [ordered]@{
      id = $p.id; platform = $p.platform; name = $p.name; mode = 'web'; startUrl = $p.startUrl
      port = $p.port; cdpUrl = ('http://127.0.0.1:' + $p.port); envVar = $p.envVar
      profileDir = $p.profileDir; logPath = $p.logPath; window = $p.window
      installedAt = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK')
    }
    Write-JsonFile -Path $p.configPath -Object $config
  }
  New-Item -ItemType Directory -Path (Join-Path $root 'logs') -Force | Out-Null
  # Configs of screens removed from the list are left in place but no longer started: Start-Screens.ps1 only starts
  # the ids in kit.json.
  Write-JsonFile -Path (Join-Path $root 'kit.json') -Object ([ordered]@{
    kitDir = $PSScriptRoot; agentDir = $agentDir; envFile = $envPath; screensFile = $screensPath
    ids = @($plan | ForEach-Object { $_.id }); portBase = $PortBase; monitor = ($mon.width.ToString() + 'x' + $mon.height)
    installedAt = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK')
  })
  Say ("OK    " + $plan.Count + " config(s) written under " + $root)

  if (-not $SkipNpm) {
    if (-not $node) { $npmResult = 'node not found' }
    else {
      $npm = Join-Path (Split-Path -Parent $node) 'npm.cmd'
      if (-not (Test-Path -LiteralPath $npm -PathType Leaf)) { $npm = 'npm.cmd' }
      Say ("...   npm install in " + $agentDir + " (playwright-core; about a minute the first time)")
      $prev = Get-Location
      try {
        Set-Location -LiteralPath $agentDir
        & $npm install --omit=dev --no-audit --no-fund --loglevel=error 2>&1 | ForEach-Object { Say ("      " + [string]$_) }
        if ($LASTEXITCODE -ne 0) { $npmResult = ('npm exited ' + $LASTEXITCODE) } else { $npmResult = 'ok' }
      } catch { $npmResult = ('failed: ' + $_.Exception.Message) }
      finally { Set-Location $prev }
      Say ("OK    npm install: " + $npmResult)
    }
  }
}

$task = $null
if (-not $NoTask) {
  $task = Register-StartupTask -StartScript $startScript -WorkingDirectory $PSScriptRoot -DryRun:$DryRun
  if ($task.registered) {
    Say ("OK    start at sign-in: " + $task.method + " -> " + $task.command)
    if ($task.Contains('fallbackReason')) { Say ("      (Task Scheduler refused: " + $task.fallbackReason + "; wrote " + $task.path + ")") }
  } else { Say ("      start at sign-in: " + $task.method) }
} else { Say 'NOTE  -NoTask: nothing starts at sign-in; run Start-Screens.ps1 yourself.' }

Say ''
Say 'Next: .\Start-Screens.ps1  (then sign in once inside each Chrome window; README-WINDOWS.md)'

if ($AsJson) {
  $summary = [ordered]@{
    ok = $true; dryRun = [bool]$DryRun; root = $root; screensFile = $screensPath; envFile = $envPath; agentDir = $agentDir
    browser = $browser; node = $node; monitor = $mon
    envMissing = @($envMissing); idsWithoutEnv = @($idsWithoutEnv); npm = $npmResult
    task = $task
    screens = @($plan)
    skipped = @($list.skipped)
  }
  Write-Output (ConvertTo-Json -InputObject $summary -Depth 8)
}
exit 0
