# Food Hub order screens, Windows kit: functions shared by Install-, Start-, Stop- and Status-Screens.ps1 (dot-sourced).
# PowerShell 5.1 (Windows 10/11), no admin rights needed. ASCII only (PowerShell 5.1 reads files without BOM as ANSI).
#
# What this kit never does: it never asks for, stores, prints or types a platform sign-in. The owner signs in inside
# each Chrome window himself. The Food Hub token is read from .env and handed to the agent's environment only; it is
# never written to a config, a log or the console. The cmdlets Read-Host and ConvertTo-SecureString are forbidden in
# every script of this folder (tests/screens-relay-windows.test.ts checks): nothing is ever typed into these scripts.
# Guide: README-WINDOWS.md (FR, then EN). Owner's guide for the three ways: docs/PLATFORM_SCREENS_RELAY.md.

Set-StrictMode -Version 2.0

$script:KitDir = $PSScriptRoot
$script:TaskName = 'FoodHub Screens'
$script:DefaultPortBase = 9222
$script:LogRotateBytes = 5MB
$script:MaxScreens = 50
$script:RequiredEnv = @('FOODHUB_URL', 'FOODHUB_SCREENS_AGENT_TOKEN')
# Same table as deploy/screens/generate-lib.mjs (PLATFORMS): default order page per platform.
$script:Platforms = [ordered]@{
  uber     = @{ label = 'Uber Eats'; startUrl = 'https://merchants.ubereats.com/manager/orders' }
  doordash = @{ label = 'DoorDash';  startUrl = 'https://order.doordash.com/' }
  skip     = @{ label = 'Skip';      startUrl = 'https://partner.skipthedishes.com/' }
}
# Same rule as generate-lib.mjs: a key or a value that looks like a sign-in secret refuses the whole list.
$script:SecretKeyRe   = '(pass(word|wd)?|pwd|secret|token|api[_-]?key|credential|otp|2fa|sms[_-]?code|cookie|session)'
$script:SecretValueRe = '(^|[^A-Za-z0-9])(pass(word|wd)?|pwd|token|secret|otp)\s*[:=]'
$script:UserKeyRe     = '^(user(name)?|login|email|e-mail|account|phone|tel)$'
$script:IdRe          = '^[A-Za-z][A-Za-z0-9_-]{1,63}$'
$script:EnvRefRe      = '^SCREEN_ID_[A-Z0-9_]{1,40}$'
$script:KnownFields   = @('id', 'platform', 'name', 'mode', 'startUrl', 'package')

# ---------------------------------------------------------------- paths and files

function Get-ScreensRoot {
  # Where profiles, configs, state and logs live: -Root, else FOODHUB_SCREENS_ROOT, else %LOCALAPPDATA%\FoodHubScreens.
  param([string]$Root)
  if ($Root) { return [System.IO.Path]::GetFullPath($Root) }
  $fromEnv = $env:FOODHUB_SCREENS_ROOT
  if ($fromEnv) { return [System.IO.Path]::GetFullPath($fromEnv) }
  return (Join-Path $env:LOCALAPPDATA 'FoodHubScreens')
}

function Resolve-KitFile {
  # screens.json / .env: an explicit path wins; else next to the scripts (windows\); else the kit folder (deploy\screens\).
  param([string]$Name, [string]$Explicit)
  if ($Explicit) { return [System.IO.Path]::GetFullPath($Explicit) }
  foreach ($dir in @($script:KitDir, (Split-Path -Parent $script:KitDir))) {
    $candidate = Join-Path $dir $Name
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
  }
  return (Join-Path $script:KitDir $Name)
}

function Get-AgentDir {
  return [System.IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $script:KitDir) 'agent'))
}

function Write-JsonFile {
  param([string]$Path, $Object)
  $json = ConvertTo-Json -InputObject $Object -Depth 8
  [System.IO.File]::WriteAllText($Path, $json + "`n", (New-Object System.Text.UTF8Encoding $false))
}

function Read-JsonFile {
  param([string]$Path)
  return (ConvertFrom-Json -InputObject ([System.IO.File]::ReadAllText($Path)))
}

function Get-Prop {
  # Property of a PSCustomObject or $null when absent (safe under strict mode).
  param($Object, [string]$Name)
  if ($null -eq $Object) { return $null }
  $p = $Object.PSObject.Properties[$Name]
  if ($null -eq $p) { return $null }
  return $p.Value
}

function Read-DotEnv {
  # KEY=value lines; comments and blanks ignored; surrounding quotes stripped. Values are never printed by this kit.
  param([string]$Path)
  $values = [ordered]@{}
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $values }
  foreach ($raw in [System.IO.File]::ReadAllLines($Path)) {
    $line = $raw.Trim()
    if ($line -eq '' -or $line.StartsWith('#')) { continue }
    if ($line.StartsWith('export ')) { $line = $line.Substring(7).Trim() }
    $eq = $line.IndexOf('=')
    if ($eq -lt 1) { continue }
    $key = $line.Substring(0, $eq).Trim()
    $val = $line.Substring($eq + 1).Trim()
    if ($key -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') { continue }
    if ($val.Length -ge 2) {
      $first = $val.Substring(0, 1); $last = $val.Substring($val.Length - 1)
      if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) { $val = $val.Substring(1, $val.Length - 2) }
    }
    $values[$key] = $val
  }
  return $values
}

function Get-EnvValue {
  param($DotEnv, [string]$Name)
  if ($null -ne $DotEnv -and $DotEnv.Contains($Name)) { return [string]$DotEnv[$Name] }
  return ''
}

# ---------------------------------------------------------------- the list of screens

function Test-SecretKeyName {
  param([string]$Name)
  if ([regex]::IsMatch($Name, $script:SecretKeyRe, 'IgnoreCase')) { return $true }
  return [regex]::IsMatch($Name, $script:UserKeyRe, 'IgnoreCase')
}

function Test-CarriesSecret {
  # True when a key is named like a secret or a user name, a value reads "token=..." / "pwd: ...", or a value is a
  # long opaque string. Checked on every entry before anything else is read.
  param($Value)
  if ($null -eq $Value) { return $false }
  if ($Value -is [string]) {
    if ([regex]::IsMatch($Value, $script:SecretValueRe, 'IgnoreCase')) { return $true }
    return ($Value.Length -gt 60 -and [regex]::IsMatch($Value, '^[A-Za-z0-9+/=_-]+$'))
  }
  if ($Value -is [System.Collections.IDictionary]) {
    foreach ($k in @($Value.Keys)) {
      if (Test-SecretKeyName ([string]$k)) { return $true }
      if (Test-CarriesSecret $Value[$k]) { return $true }
    }
    return $false
  }
  if ($Value -is [System.Management.Automation.PSCustomObject]) {
    foreach ($p in $Value.PSObject.Properties) {
      if (Test-SecretKeyName $p.Name) { return $true }
      if (Test-CarriesSecret $p.Value) { return $true }
    }
    return $false
  }
  if ($Value -is [System.Collections.IEnumerable]) {
    foreach ($item in $Value) { if (Test-CarriesSecret $item) { return $true } }
    return $false
  }
  return $false
}

function Test-StartUrl {
  # $null when fine, else the reason.
  param([string]$Url)
  $u = $null
  if (-not [System.Uri]::TryCreate($Url, [System.UriKind]::Absolute, [ref]$u)) { return 'is not a valid address' }
  if ($u.Scheme -ne 'https') { return 'must start with https://' }
  if ($u.UserInfo) { return 'must not carry a user name or a secret' }
  return $null
}

function Get-ServiceName {
  # "SCREEN_ID_UBER_1" -> "uber-1" (same as generate-lib.mjs serviceName).
  param([string]$Id)
  $s = ($Id -replace '^SCREEN_ID_', '').ToLower()
  $s = $s -replace '[^a-z0-9]+', '-'
  return ($s -replace '^-+|-+$', '')
}

function Get-EnvVarFor {
  # The .env name that holds this screen's Food Hub id (same as generate-lib.mjs envVarFor).
  param([string]$Id)
  if ($Id -match $script:EnvRefRe) { return $Id }
  return 'SCREEN_ID_' + ((Get-ServiceName $Id).ToUpper() -replace '-', '_')
}

function Read-ScreensList {
  # Reads screens.json. Returns @{ screens = web screens; skipped = Android screens (with a reason); errors = strings }.
  # Any error refuses the whole file, like the generator does.
  param([string]$Path)
  $result = @{ screens = @(); skipped = @(); errors = @() }
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    $result.errors += "cannot find $Path (copy screens.example.json to screens.json and fill it)"
    return $result
  }
  $doc = $null
  try { $doc = Read-JsonFile $Path } catch { $result.errors += "$Path is not valid JSON: " + $_.Exception.Message; return $result }
  $list = $null
  if ($doc -is [System.Array]) { $list = @($doc) }
  elseif ($doc -is [System.Management.Automation.PSCustomObject]) {
    $prop = $doc.PSObject.Properties['screens']
    if ($null -ne $prop -and ($prop.Value -is [System.Array])) { $list = @($prop.Value) }
  }
  if ($null -eq $list) { $result.errors += 'the file must contain {"screens": [ ... ]}'; return $result }
  if ($list.Count -eq 0) { $result.errors += 'the list is empty'; return $result }
  if ($list.Count -gt $script:MaxScreens) { $result.errors += "at most $($script:MaxScreens) screens per PC"; return $result }
  $seenIds = @{}; $seenNames = @{}
  for ($i = 0; $i -lt $list.Count; $i++) {
    $raw = $list[$i]; $at = 'screen ' + ($i + 1)
    if ($null -eq $raw -or -not ($raw -is [System.Management.Automation.PSCustomObject])) { $result.errors += "${at}: must be an object"; continue }
    if (Test-CarriesSecret $raw) {
      $result.errors += "${at}: carries a user name, a secret or a code - refused. The owner signs in inside the screen."
      continue
    }
    $id = ([string](Get-Prop $raw 'id')).Trim()
    if ($id -notmatch $script:IdRe) { $result.errors += "${at}: id must be 2-64 letters, digits, - or _" }
    elseif ($seenIds.ContainsKey($id.ToLower())) { $result.errors += "${at}: id ""$id"" is used twice" }
    $seenIds[$id.ToLower()] = $true
    $platform = ([string](Get-Prop $raw 'platform')).Trim().ToLower()
    if (-not $script:Platforms.Contains($platform)) { $result.errors += "${at}: platform must be one of " + (@($script:Platforms.Keys) -join ', ') }
    $name = ([string](Get-Prop $raw 'name')).Trim() -replace '\s+', ' '
    if ($name -eq '' -or $name.Length -gt 60) { $result.errors += "${at}: name is required (max 60 characters)" }
    elseif ($seenNames.ContainsKey($name.ToLower())) { $result.errors += "${at}: name ""$name"" is used twice" }
    $seenNames[$name.ToLower()] = $true
    $modeRaw = Get-Prop $raw 'mode'
    $mode = 'web'
    if ($null -ne $modeRaw) { $mode = ([string]$modeRaw).Trim().ToLower() }
    if ($mode -ne 'web' -and $mode -ne 'android') { $result.errors += "${at}: mode must be web or android" }
    $unknown = @($raw.PSObject.Properties.Name | Where-Object { $script:KnownFields -notcontains $_ })
    if ($unknown.Count -gt 0) { $result.errors += "${at}: unknown field(s) " + ($unknown -join ', ') }
    if ($mode -eq 'android') {
      if ($null -ne (Get-Prop $raw 'startUrl')) { $result.errors += "${at}: startUrl is only for mode web" }
      $result.skipped += [ordered]@{
        id = $id; platform = $platform; name = $name; mode = 'android'
        reason = 'Android screens run on the Docker kit (compose profile "android") or a real device; this PC kit runs web screens only.'
      }
      continue
    }
    if ($null -ne (Get-Prop $raw 'package')) { $result.errors += "${at}: package is only for mode android" }
    $startUrl = ([string](Get-Prop $raw 'startUrl')).Trim()
    if ($startUrl -eq '' -and $script:Platforms.Contains($platform)) { $startUrl = [string]$script:Platforms[$platform].startUrl }
    $bad = $null
    if ($startUrl -eq '') { $bad = 'is required' } else { $bad = Test-StartUrl $startUrl }
    if ($bad) { $result.errors += "${at}: startUrl $bad" }
    $result.screens += [ordered]@{ id = $id; platform = $platform; name = $name; mode = 'web'; startUrl = $startUrl }
  }
  return $result
}

# ---------------------------------------------------------------- the plan: ports, folders, windows

function Get-MonitorSize {
  # -Monitor 1920x1080 wins; else the primary monitor's working area; else 1920x1080.
  param([string]$Monitor)
  if ($Monitor -and $Monitor -match '^(\d{3,5})x(\d{3,5})$') { return @{ width = [int]$Matches[1]; height = [int]$Matches[2]; source = 'parameter' } }
  try {
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
    $area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
    if ($area.Width -gt 100 -and $area.Height -gt 100) { return @{ width = [int]$area.Width; height = [int]$area.Height; source = 'primary monitor' } }
  } catch { }
  return @{ width = 1920; height = 1080; source = 'default' }
}

function New-ScreensPlan {
  # One entry per web screen: unique debugging port (PortBase + n), profile folder, config, log, window tile.
  param($Screens, [string]$Root, [int]$PortBase, [int]$MonitorWidth, [int]$MonitorHeight)
  $Screens = @($Screens)
  $n = $Screens.Count
  $cols = [int][math]::Max(1, [math]::Ceiling([math]::Sqrt($n)))
  $rows = [int][math]::Max(1, [math]::Ceiling($n / $cols))
  $w = [int][math]::Floor($MonitorWidth / $cols)
  $h = [int][math]::Floor($MonitorHeight / $rows)
  $out = @()
  for ($i = 0; $i -lt $n; $i++) {
    $s = $Screens[$i]
    $dir = Join-Path $Root $s.id
    $out += [ordered]@{
      id = $s.id; platform = $s.platform; name = $s.name; mode = 'web'; startUrl = $s.startUrl
      port = $PortBase + $i
      envVar = (Get-EnvVarFor $s.id)
      dir = $dir
      profileDir = (Join-Path $dir 'profile')
      configPath = (Join-Path $dir 'screen.json')
      logPath = (Join-Path (Join-Path $Root 'logs') ($s.id + '.log'))
      window = [ordered]@{ x = [int](($i % $cols) * $w); y = [int]([math]::Floor($i / $cols) * $h); width = $w; height = $h }
    }
  }
  return $out
}

function Get-ScreenConfigs {
  # Every <Root>\<id>\screen.json written by Install-Screens.ps1, sorted by port.
  param([string]$Root)
  # Callers wrap the result in @(): PowerShell unrolls arrays on output.
  $configs = @()
  if (-not (Test-Path -LiteralPath $Root -PathType Container)) { return $configs }
  foreach ($dir in @(Get-ChildItem -LiteralPath $Root -Directory)) {
    $file = Join-Path $dir.FullName 'screen.json'
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { continue }
    try { $configs += (Read-JsonFile $file) } catch { Write-Warning "Cannot read $file : $($_.Exception.Message)" }
  }
  return @($configs | Sort-Object { [int]$_.port })
}

# ---------------------------------------------------------------- programs and processes

function Find-Browser {
  # chrome.exe in the usual places, else msedge.exe (same flags: both are Chromium).
  $candidates = @()
  foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA)) {
    if ($base) { $candidates += (Join-Path $base 'Google\Chrome\Application\chrome.exe') }
  }
  foreach ($base in @(${env:ProgramFiles(x86)}, $env:ProgramFiles, $env:LOCALAPPDATA)) {
    if ($base) { $candidates += (Join-Path $base 'Microsoft\Edge\Application\msedge.exe') }
  }
  foreach ($c in $candidates) { if (Test-Path -LiteralPath $c -PathType Leaf) { return $c } }
  foreach ($exe in @('chrome.exe', 'msedge.exe')) {
    foreach ($hive in @('HKCU:', 'HKLM:')) {
      try {
        $key = Get-ItemProperty -Path ($hive + '\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\' + $exe) -ErrorAction Stop
        $path = [string](Get-Prop $key '(default)')
        if ($path -and (Test-Path -LiteralPath $path -PathType Leaf)) { return $path }
      } catch { }
    }
    $cmd = Get-Command $exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
  }
  return $null
}

function Find-NodeExe {
  $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, (Join-Path $env:LOCALAPPDATA 'Programs'))) {
    if (-not $base) { continue }
    $c = Join-Path $base 'nodejs\node.exe'
    if (Test-Path -LiteralPath $c -PathType Leaf) { return $c }
  }
  return $null
}

function ConvertTo-Argument {
  # Quote one argument for a Windows command line (CreateProcess rules).
  param([string]$Value)
  if ($null -eq $Value -or $Value -eq '') { return '""' }
  if ($Value -notmatch '[\s"]') { return $Value }
  $escaped = $Value -replace '(\\*)"', '$1$1\"'
  $escaped = $escaped -replace '(\\+)$', '$1$1'
  return '"' + $escaped + '"'
}

function Start-ChildProcess {
  # Starts a program with its own environment. -CaptureOutput: no console window, stdout/stderr readable (agents).
  param([string]$FilePath, [string[]]$ArgumentList, [hashtable]$Environment, [string]$WorkingDirectory, [switch]$CaptureOutput)
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $FilePath
  $psi.Arguments = (@($ArgumentList | ForEach-Object { ConvertTo-Argument $_ }) -join ' ')
  $psi.UseShellExecute = $false
  if ($WorkingDirectory) { $psi.WorkingDirectory = $WorkingDirectory }
  if ($Environment) { foreach ($k in @($Environment.Keys)) { $psi.EnvironmentVariables[[string]$k] = [string]$Environment[$k] } }
  if ($CaptureOutput) { $psi.CreateNoWindow = $true; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true }
  $p = New-Object System.Diagnostics.Process
  $p.StartInfo = $psi
  [void]$p.Start()
  return $p
}

function Get-RelayProcesses {
  # Browser and agent processes with their command lines: one query per watchdog pass. Callers wrap it in @().
  try {
    return @(Get-CimInstance -ClassName Win32_Process -Filter "Name = 'chrome.exe' OR Name = 'msedge.exe' OR Name = 'node.exe'" -ErrorAction Stop | Select-Object ProcessId, Name, CommandLine)
  } catch { return @() }
}

function Find-BrowserProcess {
  # The browser process (not a renderer: no --type=) that uses this profile folder.
  param($Processes, [string]$ProfileDir)
  foreach ($p in @($Processes)) {
    if ($null -eq $p) { continue }
    if ($p.Name -ne 'chrome.exe' -and $p.Name -ne 'msedge.exe') { continue }
    $cl = [string]$p.CommandLine
    if ($cl -eq '') { continue }
    if ($cl.IndexOf('--type=', [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { continue }
    if ($cl.IndexOf($ProfileDir, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { return $p }
  }
  return $null
}

function Find-AgentProcess {
  # node agent.mjs --screen <id>: the marker makes an agent recognizable after the watchdog restarted.
  param($Processes, [string]$Id)
  $re = 'agent\.mjs.*--screen\s+' + [regex]::Escape($Id) + '(\s|$)'
  foreach ($p in @($Processes)) {
    if ($null -eq $p) { continue }
    if ($p.Name -ne 'node.exe') { continue }
    if (([string]$p.CommandLine) -match $re) { return $p }
  }
  return $null
}

function Test-ProcessAlive {
  param([int]$ProcessId)
  if ($ProcessId -le 0) { return $false }
  $p = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  return ($null -ne $p)
}

function Test-LocalPort {
  # True when something listens on 127.0.0.1:<port> (Chrome's debugging port once the window is up).
  param([int]$Port)
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $ar = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
    if ($ar.AsyncWaitHandle.WaitOne(500)) { $client.EndConnect($ar); return $true }
    return $false
  } catch { return $false } finally { $client.Close() }
}

function Stop-ProcessGracefully {
  # Ask the window to close (Chrome then saves its session), force after the timeout.
  param([int]$ProcessId, [int]$TimeoutSeconds = 10)
  $p = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if ($null -eq $p) { return 'not running' }
  $closed = $false
  try { $closed = $p.CloseMainWindow() } catch { $closed = $false }
  if ($closed -and $p.WaitForExit($TimeoutSeconds * 1000)) { return 'closed' }
  Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
  return 'killed'
}

# ---------------------------------------------------------------- logs

function Write-ScreenLog {
  # One dated line; the file rotates to <name>.log.1 past 5 MB. Never log a value from .env.
  param([string]$LogPath, [string]$Line)
  try {
    $dir = Split-Path -Parent $LogPath
    if (-not (Test-Path -LiteralPath $dir -PathType Container)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    if ((Test-Path -LiteralPath $LogPath -PathType Leaf) -and ((Get-Item -LiteralPath $LogPath).Length -gt $script:LogRotateBytes)) {
      Move-Item -LiteralPath $LogPath -Destination ($LogPath + '.1') -Force
    }
    Add-Content -LiteralPath $LogPath -Value ('{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Line) -Encoding UTF8
  } catch { }
}

function Get-LastLogLine {
  param([string]$LogPath)
  if (-not (Test-Path -LiteralPath $LogPath -PathType Leaf)) { return '' }
  try { return [string](Get-Content -LiteralPath $LogPath -Tail 1 -ErrorAction Stop) } catch { return '' }
}

# ---------------------------------------------------------------- start at sign-in (no admin)

function Get-StartCommand {
  param([string]$StartScript)
  return @{ file = 'powershell.exe'; arguments = ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ' + (ConvertTo-Argument $StartScript)) }
}

function Get-StartupCmdPath {
  return (Join-Path ([Environment]::GetFolderPath('Startup')) ($script:TaskName + '.cmd'))
}

function Register-StartupTask {
  # Scheduled Task "FoodHub Screens" at sign-in of the current user (no admin). If the Task Scheduler refuses, a .cmd
  # in the user's Startup folder does the same job.
  param([string]$StartScript, [string]$WorkingDirectory, [switch]$DryRun)
  $cmd = Get-StartCommand $StartScript
  $user = $env:USERDOMAIN + '\' + $env:USERNAME
  $result = [ordered]@{ name = $script:TaskName; method = 'scheduledTask'; user = $user; command = ($cmd.file + ' ' + $cmd.arguments); registered = $false }
  if ($DryRun) { $result.method = 'scheduledTask (dry run: not registered)'; return $result }
  try {
    $action = New-ScheduledTaskAction -Execute $cmd.file -Argument $cmd.arguments -WorkingDirectory $WorkingDirectory
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
    $trigger.Delay = 'PT20S'
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    $settings.ExecutionTimeLimit = 'PT0S'
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    $description = 'Food Hub order screens: one Chrome per platform screen and its agent, started at sign-in. See deploy/screens/windows/README-WINDOWS.md'
    Register-ScheduledTask -TaskName $script:TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description $description -Force -ErrorAction Stop | Out-Null
    $result.registered = $true
    return $result
  } catch {
    $result.method = 'startupFolder'
    $result.fallbackReason = $_.Exception.Message
    $cmdFile = Get-StartupCmdPath
    $content = "@echo off`r`nrem Food Hub order screens (deploy/screens/windows/README-WINDOWS.md). Written because the Scheduled Task could not be registered.`r`nstart """" /min " + $cmd.file + ' ' + $cmd.arguments + "`r`n"
    [System.IO.File]::WriteAllText($cmdFile, $content, [System.Text.Encoding]::ASCII)
    $result.path = $cmdFile
    $result.registered = $true
    return $result
  }
}

function Unregister-StartupTask {
  # Removes the task and the Startup .cmd. Profiles (sign-ins) stay on disk. Callers wrap the result in @().
  param([switch]$DryRun)
  $removed = @()
  $task = $null
  try { $task = Get-ScheduledTask -TaskName $script:TaskName -ErrorAction Stop } catch { $task = $null }
  if ($null -ne $task) {
    if (-not $DryRun) { Unregister-ScheduledTask -TaskName $script:TaskName -Confirm:$false -ErrorAction Stop }
    $removed += ('scheduled task "' + $script:TaskName + '"')
  }
  $cmdFile = Get-StartupCmdPath
  if (Test-Path -LiteralPath $cmdFile -PathType Leaf) {
    if (-not $DryRun) { Remove-Item -LiteralPath $cmdFile -Force }
    $removed += $cmdFile
  }
  return $removed
}

function Get-StartupTaskState {
  # "Ready" / "Running" / ... from the Task Scheduler, "startup folder" for the fallback, "not installed" otherwise.
  try {
    $task = Get-ScheduledTask -TaskName $script:TaskName -ErrorAction Stop
    if ($null -ne $task) { return ('scheduled task: ' + [string]$task.State) }
  } catch { }
  if (Test-Path -LiteralPath (Get-StartupCmdPath) -PathType Leaf) { return 'startup folder' }
  return 'not installed'
}

# ---------------------------------------------------------------- watchdog state

function Get-WatchdogFile { param([string]$Root) return (Join-Path $Root 'watchdog.json') }

function Get-RunningWatchdog {
  # The pid of a live Start-Screens.ps1 for this root, or 0.
  param([string]$Root)
  $file = Get-WatchdogFile $Root
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { return 0 }
  $info = $null
  try { $info = Read-JsonFile $file } catch { return 0 }
  $watchPid = [int](Get-Prop $info 'pid')
  if ($watchPid -le 0 -or -not (Test-ProcessAlive $watchPid)) { return 0 }
  try {
    $proc = Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId = ' + $watchPid) -ErrorAction Stop
    if ($null -eq $proc) { return 0 }
    if (([string]$proc.CommandLine) -notmatch 'Start-Screens\.ps1') { return 0 }
  } catch { return 0 }
  return $watchPid
}
