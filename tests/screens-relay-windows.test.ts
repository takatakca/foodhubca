// Windows kit of the relay (deploy/screens/windows): the in-store PC runs one Chrome + one agent per screen.
// Always: the scripts never ask for or handle a sign-in (no Read-Host, no ConvertTo-SecureString, no "password"
// outside comments), the README has both languages and the owner's steps, the kit mirrors the generator's rules.
// When PowerShell is on PATH (Windows): the scripts parse with 0 errors, Install-Screens.ps1 -DryRun plans unique
// ports and profile folders from the example list, skips the Android screen, writes nothing, and refuses a list that
// carries a secret, like deploy/screens/generate.mjs does.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const KIT = path.join(__dirname, '../deploy/screens/windows');
const SCRIPTS = ['Screens-Common.ps1', 'Install-Screens.ps1', 'Start-Screens.ps1', 'Stop-Screens.ps1', 'Status-Screens.ps1'];
const EXAMPLE = path.join(__dirname, '../deploy/screens/screens.example.json');
const read = (name: string) => readFileSync(path.join(KIT, name), 'utf8');

/** powershell.exe (Windows PowerShell 5.1) when it is on PATH, else null: the parse + dry-run tests are skipped. */
function findPowerShell(): string | null {
  if (process.platform !== 'win32') return null;
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8', timeout: 30_000 });
  return r.status === 0 && Number(r.stdout.trim()) >= 5 ? 'powershell' : null;
}
const ps = findPowerShell();
const itPs = ps ? it : it.skip;

function runScript(script: string, args: string[]) {
  const r = spawnSync(ps!, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(KIT, script), ...args], { encoding: 'utf8', timeout: 120_000 });
  return { status: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

/** Code only: comments stripped (a line comment explaining the rule is allowed to name the forbidden words). */
function withoutComments(source: string): string {
  return source.replace(/<#[\s\S]*?#>/g, '').split(/\r?\n/).map((l) => l.replace(/(^|\s)#.*$/, '')).join('\n');
}

describe('windows kit: files and rules (always)', () => {
  it('ships the four scripts, the shared functions and the README', () => {
    for (const f of [...SCRIPTS, 'README-WINDOWS.md']) expect(existsSync(path.join(KIT, f)), f).toBe(true);
  });

  it('never prompts, never handles a secret: no Read-Host, ConvertTo-SecureString or "password" outside comments', () => {
    for (const name of SCRIPTS) {
      const code = withoutComments(read(name));
      for (const word of ['Read-Host', 'ConvertTo-SecureString', 'password']) {
        expect(code.toLowerCase().includes(word.toLowerCase()), `${name} contains ${word}`).toBe(false);
      }
      expect(code).not.toMatch(/Get-Credential|PSCredential|Invoke-Expression|\biex\b/i);
    }
  });

  it('refuses the same secret-looking keys as the generator and shares its platform table', () => {
    const common = read('Screens-Common.ps1');
    const lib = readFileSync(path.join(__dirname, '../deploy/screens/generate-lib.mjs'), 'utf8');
    for (const key of ['pass(word|wd)?', 'pwd', 'secret', 'token', 'api[_-]?key', 'credential', 'otp', '2fa', 'sms[_-]?code', 'cookie', 'session']) expect(common).toContain(key);
    for (const url of ['https://merchants.ubereats.com/manager/orders', 'https://order.doordash.com/', 'https://restaurants.skipthedishes.com/']) {
      expect(lib).toContain(url);
      expect(common).toContain(url);
    }
    expect(common).toMatch(/\$script:DefaultPortBase = 9222/);
    expect(common).toMatch(/LogRotateBytes = 5MB/);
  });

  it('starts Chrome with its own profile, debugging port, window and start URL (no --restore-last-session: see the comment there), never the token on a command line', () => {
    const start = read('Start-Screens.ps1');
    for (const flag of ['--user-data-dir=', '--remote-debugging-port=', '--no-first-run', '--disable-session-crashed-bubble', '--window-position=', '--window-size=', '[string]$Screen.startUrl']) expect(start).toContain(flag);
    expect(start).toMatch(/--restore-last-session is NOT used on purpose/);
    expect(withoutComments(start)).not.toContain('--restore-last-session');
    for (const env of ['FOODHUB_URL', 'FOODHUB_SCREENS_AGENT_TOKEN', 'SCREEN_ID', 'SCREEN_START_URL', 'CDP_URL', 'HEARTBEAT_SECONDS']) expect(start).toContain(env);
    expect(start).toContain('-Environment $r.env'); // the agent gets the values through its environment
    expect(start).not.toMatch(/--token|FOODHUB_SCREENS_AGENT_TOKEN=/);
    expect(start).toMatch(/IntervalSeconds = 30/);
  });

  it('README: French first, then English; the 10 steps, the sign-in, Guacamole, the sign-in-page case', () => {
    const readme = read('README-WINDOWS.md');
    const fr = readme.indexOf('# Écrans de commande sur le PC Windows');
    const en = readme.indexOf('# Order screens on the store\'s Windows PC');
    expect(fr).toBeGreaterThanOrEqual(0);
    expect(en).toBeGreaterThan(fr);
    for (const part of [readme.slice(fr, en), readme.slice(en)]) {
      expect(part).toMatch(/\n10\. /);
      expect(part).toMatch(/Guacamole/);
      expect(part).toMatch(/Install-Screens\.ps1/);
      expect(part).toMatch(/Status-Screens\.ps1/);
    }
    expect(readme).toMatch(/page de connexion de la plateforme/);
    expect(readme).toMatch(/platform's sign-in page/);
    expect(readme).toMatch(/Po Poulet NDG/);
    // The guide never carries a real address, token or phone number.
    expect(readme).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/);
    expect(readme).not.toMatch(/\b\d{3}[-. ]\d{3}[-. ]\d{4}\b/);
  });
});

describe('windows kit: PowerShell parse and dry runs (when powershell is on PATH)', () => {
  itPs('every script parses with 0 errors ([Parser]::ParseFile)', () => {
    const cmd = [
      '$bad = 0;',
      `foreach ($f in Get-ChildItem -LiteralPath '${KIT.replace(/'/g, "''")}' -Filter *.ps1) {`,
      '  $t = $null; $e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$t, [ref]$e);',
      '  Write-Output ("{0}: {1}" -f $f.Name, $e.Count); $bad += $e.Count; foreach ($x in $e) { Write-Output ("  " + $x.Message) }',
      '}',
      'exit $bad',
    ].join(' ');
    const r = spawnSync(ps!, ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8', timeout: 60_000 });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    for (const name of SCRIPTS) expect(r.stdout).toContain(`${name}: 0`);
  });

  itPs('Install-Screens.ps1 -DryRun plans unique ports and folders from the example, skips Android, writes nothing', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'foodhub-screens-'));
    const target = path.join(root, 'nope');
    try {
      const r = runScript('Install-Screens.ps1', ['-DryRun', '-AsJson', '-ScreensFile', EXAMPLE, '-EnvFile', path.join(root, 'missing.env'), '-Root', target]);
      expect(r.status, r.out).toBe(0);
      const plan = JSON.parse(r.out.slice(r.out.indexOf('{')));
      expect(plan.ok).toBe(true);
      expect(plan.dryRun).toBe(true);
      expect(plan.screens.map((s: any) => s.id)).toEqual(['SCREEN_ID_UBER_1', 'SCREEN_ID_DOORDASH_1', 'SCREEN_ID_SKIP_1']);
      expect(plan.skipped.map((s: any) => s.id)).toEqual(['SCREEN_ID_DOORDASH_2']);
      const ports = plan.screens.map((s: any) => s.port);
      expect(ports).toEqual([9222, 9223, 9224]);
      expect(new Set(ports).size).toBe(ports.length);
      const dirs = plan.screens.map((s: any) => s.profileDir.toLowerCase());
      expect(new Set(dirs).size).toBe(dirs.length);
      for (const s of plan.screens) expect(s.profileDir.toLowerCase()).toContain(target.toLowerCase());
      expect(plan.envMissing).toEqual(['FOODHUB_URL', 'FOODHUB_SCREENS_AGENT_TOKEN']);
      expect(String(plan.task.method)).toMatch(/dry run/);
      expect(existsSync(target)).toBe(false); // nothing written
      expect(r.out).not.toMatch(/Register-ScheduledTask|npm install/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  itPs('a list that carries a secret is refused with exit 1, before anything is planned', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'foodhub-screens-'));
    try {
      const cases: Array<[string, unknown, RegExp]> = [
        ['password key', { screens: [{ id: 's01', platform: 'uber', name: 'U', password: 'x' }] }, /carries a user name, a secret or a code/],
        ['email key', { screens: [{ id: 's01', platform: 'uber', name: 'U', email: 'a@b.c' }] }, /carries a user name/],
        ['token in a value', { screens: [{ id: 's01', platform: 'uber', name: 'token: abc' }] }, /carries a user name/],
        ['user in the address', { screens: [{ id: 's01', platform: 'uber', name: 'U', startUrl: 'https://u:p@merchants.ubereats.com/' }] }, /startUrl must not carry/],
        ['http address', { screens: [{ id: 's01', platform: 'uber', name: 'U', startUrl: 'http://merchants.ubereats.com/' }] }, /https/],
        ['duplicate id', { screens: [{ id: 's01', platform: 'uber', name: 'U' }, { id: 'S01', platform: 'skip', name: 'S' }] }, /used twice/],
        ['unknown platform', { screens: [{ id: 's01', platform: 'grubhub', name: 'U' }] }, /platform must be one of uber, doordash, skip/],
        ['empty', { screens: [] }, /empty/],
      ];
      for (const [label, doc, re] of cases) {
        const file = path.join(root, 'screens.json');
        writeFileSync(file, JSON.stringify(doc));
        const r = runScript('Install-Screens.ps1', ['-DryRun', '-ScreensFile', file, '-Root', path.join(root, 'r')]);
        expect(r.status, label).toBe(1);
        expect(r.out, label).toMatch(re);
      }
      expect(readdirSync(root)).toEqual(['screens.json']);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  itPs('a real install into a scratch root (-NoTask -SkipNpm) writes configs without any secret; Start/Stop/Status dry-run from them', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'foodhub-screens-'));
    const target = path.join(root, 'r');
    const envFile = path.join(root, '.env');
    writeFileSync(envFile, 'FOODHUB_URL=https://foodhub.example.test\nFOODHUB_SCREENS_AGENT_TOKEN=unit-test-token-value-never-written-anywhere-else\nSCREEN_ID_UBER_1=s01\n');
    try {
      const inst = runScript('Install-Screens.ps1', ['-NoTask', '-SkipNpm', '-ScreensFile', EXAMPLE, '-EnvFile', envFile, '-Root', target]);
      expect(inst.status, inst.out).toBe(0);
      expect(inst.out).not.toContain('unit-test-token-value');
      const configs = ['SCREEN_ID_UBER_1', 'SCREEN_ID_DOORDASH_1', 'SCREEN_ID_SKIP_1'].map((id) => JSON.parse(readFileSync(path.join(target, id, 'screen.json'), 'utf8')));
      expect(new Set(configs.map((c) => c.port)).size).toBe(3);
      expect(configs[0]).toMatchObject({ id: 'SCREEN_ID_UBER_1', port: 9222, cdpUrl: 'http://127.0.0.1:9222', envVar: 'SCREEN_ID_UBER_1', mode: 'web' });
      expect(existsSync(path.join(target, 'SCREEN_ID_DOORDASH_2'))).toBe(false);
      // No value from .env in anything written.
      const written = readdirSync(target, { recursive: true }).map((f) => path.join(target, String(f))).filter((f) => f.endsWith('.json')).map((f) => readFileSync(f, 'utf8')).join('\n');
      expect(written).not.toMatch(/unit-test-token-value|foodhub\.example\.test/);

      const start = runScript('Start-Screens.ps1', ['-DryRun', '-Root', target]);
      expect(start.status, start.out).toBe(0);
      expect(start.out).toMatch(/WOULD START browser\s+SCREEN_ID_UBER_1:.*--user-data-dir=.*--remote-debugging-port=9222 /);
      expect(start.out).toMatch(/WOULD START agent\s+SCREEN_ID_UBER_1:.*agent\.mjs --screen SCREEN_ID_UBER_1\s+\(env: CDP_URL, FOODHUB_SCREENS_AGENT_TOKEN, FOODHUB_URL, NODE_NO_WARNINGS, SCREEN_ID, SCREEN_START_URL\)/);
      expect(start.out).not.toContain('unit-test-token-value'); // names only, never the value
      expect(start.out).toContain('Dry run: nothing was started.');

      const stop = runScript('Stop-Screens.ps1', ['-DryRun', '-Unregister', '-Root', target]);
      expect(stop.status, stop.out).toBe(0);
      expect(stop.out).toContain('Dry run: nothing was stopped.');

      const status = runScript('Status-Screens.ps1', ['-AsJson', '-Root', target]);
      expect(status.status, status.out).toBe(0);
      const s = JSON.parse(status.out.slice(status.out.indexOf('{')));
      expect(s.installed).toBe(true);
      expect(s.envMissing).toEqual([]);
      expect(s.screens.map((x: any) => [x.id, x.port, x.browserPid, x.agentPid])).toEqual([['SCREEN_ID_UBER_1', 9222, 0, 0], ['SCREEN_ID_DOORDASH_1', 9223, 0, 0], ['SCREEN_ID_SKIP_1', 9224, 0, 0]]);
      expect(status.out).not.toContain('unit-test-token-value');
      expect(existsSync(path.join(target, 'watchdog.json'))).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

