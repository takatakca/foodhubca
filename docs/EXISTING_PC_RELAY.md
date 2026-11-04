# Existing Windows PC screens — continuity findings

Use the existing PC installation first. No PC processes, profiles, scheduled tasks or settings were changed by this investigation. This Linux cloud session does not have a verified connection to the owner's Windows PC.

## Evidence found

- `foodhubca` commit `acd58d41097f434653d8618f0aec21bc95af0f62`, Oct 29, 2026 at 05:00 EDT: Windows kit built by Claude on the owner's PC. Its commit message records zero PowerShell parser errors, dry runs and a real install into a scratch root, with the token never written. It explicitly says the Scheduled Task was never registered on that PC during this test.
- Commit `f6dccb29397b37d338efc12807cce54e9701a73b`, Oct 29 at 05:07 EDT: Chrome 142 / Windows 11 behavior measured and `--restore-last-session` removed, retaining sign-ins through existing profile cookies.
- `tests/screens-relay-windows.test.ts` shows what the install validation did: three synthetic web screens under a temporary `foodhub-screens-*` root, `-NoTask -SkipNpm`; Start/Stop were dry runs; Status found zero browser/agent PIDs. The temporary root is removed after the test. This proves the installer was exercised, not that 54 real accounts were deployed or logged in.
- Public PR107 contains the Windows kit; PR110 is the Linux relay gateway; PR112 is the one-command Linux setup. Those Linux PRs do not establish the Windows PC's current state.
- `docs/REGISTRE_TAKATAK.md` section 4.2 lists the source changes as merged but leaves deployment, token/domain configuration, setup and owner sign-in as remaining steps. This note may predate a subsequent private/local installation; it does not disprove the user's report.
- Public agent board inspection is now complete for the retrieved snapshot: followed the actual public `?timeline_page=1`, `=2`, `=3` links and deduplicated 360 timeline nodes (matching the current totalCount), including 354 comments. The original snapshot had 358 nodes; two arrived during investigation. The source HTML and deduplicated comments are saved alongside this note. Board comment https://github.com/takatakca/foodhubca/issues/105#issuecomment-6492700891 explicitly confirms the Windows kit dry-run + real install test, with the task never registered there. No later public comment establishes real-account PC installation/current sessions. No Google Drive or ChatGPT-history connector is available in this session. The owner's local/private notes may have later installation evidence.

## Existing layout and preservation

Default installed state: `%LOCALAPPDATA%\FoodHubScreens`. An explicit `-Root` wins, then `FOODHUB_SCREENS_ROOT`, then the default.

- `<id>\profile`: persistent Chrome profile, including existing provider sessions; preserve it.
- `<id>\screen.json`: local screen configuration, no secret.
- `kit.json`: actual kit directory, manifest path, environment-file path, registered screen IDs and port base.
- `logs\<id>.log`: local heartbeat/watchdog logs.
- Windows Scheduled Task: `FoodHub Screens`; fallback is `FoodHub Screens.cmd` in the current user's Startup folder.

The documented `C:\FoodHub\screens\` source directory is an example, not a verified installation path. Resolve the actual path from `kit.json`.

The installer does not delete existing profile contents (`New-Item -Force` creates/reuses directories), but it rewrites `screen.json` and `kit.json`; changing the list also changes which IDs start. Therefore installation is not a read-only status check and should not be rerun before discovering existing state.

## Read-only checks on the existing PC

In PowerShell on that PC, determine the existing root and script location:

```powershell
$screenRoot = if ($env:FOODHUB_SCREENS_ROOT) { $env:FOODHUB_SCREENS_ROOT } else { Join-Path $env:LOCALAPPDATA 'FoodHubScreens' }
$manifestPath = Join-Path $screenRoot 'kit.json'
if (Test-Path -LiteralPath $manifestPath) {
    $kit = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
    $statusScript = Join-Path $kit.kitDir 'Status-Screens.ps1'
    $state = & $statusScript -Root $screenRoot -AsJson | ConvertFrom-Json
    $state | Select-Object installed, watchdogPid, startAtSignIn, envMissing, @{Name='screenCount';Expression={@($_.screens).Count}}
    $state.screens | Select-Object id, platform, browserPid, agentPid, port, portOpen
} else {
    Write-Output 'No kit.json at this root; check the existing shortcut or Scheduled Task for its custom -Root before concluding it is missing.'
}
```

This reads status only. It does not restart browsers, change sessions, register tasks or print .env values. Keep any output containing real screen names/paths/logs private. `installed=true` establishes that configs exist; browser/agent PIDs and port responses show local process state; current Food Hub heartbeats and an owner view of each platform establish whether actual provider sessions work.

## Extend the existing manifest without changing account identities

Keep the actual `screensFile` recorded in `kit.json` and its existing ID → provider assignments. A factory `screens.54.example.json` is for a new installation; replacing a mixed 18-screen manifest with that preset could redirect an existing Uber profile to DoorDash even though the profile directory remains intact.

Food Hub now proposes only missing accounts toward 18 per provider and appends their slot numbers. After the PC inventory is verified, append those exact new IDs/providers to the existing manifest; retain every existing entry, profile directory and relay address. Check the proposed plan with `-DryRun` before applying a PC-side update. Creating Food Hub screen records does not itself start new PC browsers/agents.

## Concrete compatibility fix

The Windows kit still capped manifests at 50 screens even though the hub and relay generator support 99 and the owner requires 54. Updated the Windows validation limit to the shared 99-slot capacity and added cross-contract plus Windows-native dry-run regression coverage for accepting 54, unique ports/profiles, and rejecting 100. This changes source validation only and does not upgrade or alter the existing PC installation. Windows-native tests must run on the PC/Windows CI; Linux tests cannot establish current PC readiness.

— signé : Codex (unified-platform-workspaces) @ Codex cloud · 2026-11-04
