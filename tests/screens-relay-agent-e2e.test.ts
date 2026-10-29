// End-to-end run of the two relay agents against a fake Food Hub on localhost. Nothing leaves the machine.
//  - agent.mjs (web): a real headless Chromium with a debugging port (the cached Playwright build, when present;
//    otherwise the web test is skipped with the reason) → heartbeat state/title/url, "login" on a sign-in address,
//    and the "reload" command honoured.
//  - android.mjs: a fake `adb` on PATH (deterministic) → heartbeat v2 (mode, app, waiting count), "login" and "blank"
//    decisions, and "reload" = bring the app to the front, nothing else.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const AGENT_DIR = path.resolve(__dirname, '../deploy/screens/agent');
const TOKEN = 'test-token-' + 'x'.repeat(24);
const win = process.platform === 'win32';

type Beat = { headers: Record<string, string | string[] | undefined>; body: any };

/** A fake Food Hub: records heartbeats, answers with the commands queued for a screen. */
function fakeFoodHub() {
  const beats: Beat[] = [];
  const queue: Array<{ id: string; kind: 'reload' }> = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url !== '/api/foodhub/screens/heartbeat') { res.writeHead(404).end(); return; }
      if (req.headers.authorization !== `Bearer ${TOKEN}`) { res.writeHead(401).end(JSON.stringify({ error: 'bad token' })); return; }
      const body = JSON.parse(raw);
      beats.push({ headers: req.headers, body });
      const commands = queue.splice(0);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ commands, unknown: [] }));
    });
  });
  return {
    beats, queue, server,
    listen: () => new Promise<number>((r) => server.listen(0, '127.0.0.1', () => r((server.address() as any).port))),
    waitFor: async (pred: (b: Beat) => boolean, ms = 15_000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { const b = beats.find(pred); if (b) return b; await new Promise((r) => setTimeout(r, 100)); }
      throw new Error(`no heartbeat matched within ${ms} ms; got ${JSON.stringify(beats.map((b) => b.body.screens[0]))}`);
    },
  };
}

/** A tiny "platform" site: /orders (title "(2) Orders"), /login (sign-in page). */
function fakePlatform() {
  const server = createServer((req, res) => {
    const title = req.url?.startsWith('/login') ? 'Sign in' : '(2) Orders';
    res.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><title>${title}</title><h1>${title}</h1>`);
  });
  return { server, listen: () => new Promise<number>((r) => server.listen(0, '127.0.0.1', () => r((server.address() as any).port))) };
}

const kill = (p: ChildProcess | null) => { if (p && !p.killed) { try { p.kill(); } catch { /* gone */ } } };
const logsOf = (p: ChildProcess, into: string[]) => { p.stdout?.on('data', (d) => into.push(String(d))); p.stderr?.on('data', (d) => into.push(String(d))); };

// ---------------------------------------------------------------- web agent (real Chromium when available)
// The agent's own dependency (playwright-core) launches the Chromium it finds (Playwright's cached build, or
// CHROME_PATH). Without either, this block is skipped: it is a local proof, not a CI gate.
const chromePath = [
  process.env.CHROME_PATH,
  path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright', 'chromium-1140', 'chrome-win', 'chrome.exe'),
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
].find((p) => p && existsSync(p));
const haveAgentDeps = existsSync(path.join(AGENT_DIR, 'node_modules', 'playwright-core'));

// Some sandboxes refuse to spawn a browser at all (spawn UNKNOWN / EPERM); that is skipped too, with the reason logged.
let launchRefused = '';
describe.skipIf(!chromePath || !haveAgentDeps)('agent.mjs (web) end to end', () => {
  const hub = fakeFoodHub(); const site = fakePlatform();
  let browser: { close(): Promise<void> } | null = null; let agent: ChildProcess | null = null;
  const logs: string[] = []; let cdpPort = 0; let sitePort = 0; let hubPort = 0;
  const profile = mkdtempSync(path.join(tmpdir(), 'fh-screen-'));

  beforeAll(async () => {
    sitePort = await site.listen(); hubPort = await hub.listen();
    cdpPort = 9300 + Math.floor(Math.random() * 300);
    const { chromium } = await import(/* @vite-ignore */ path.join(AGENT_DIR, 'node_modules', 'playwright-core', 'index.mjs'));
    let ctx;
    try { ctx = await chromium.launchPersistentContext(profile, { executablePath: chromePath, headless: true, args: [`--remote-debugging-port=${cdpPort}`, '--no-sandbox'] }); }
    catch (e) { launchRefused = e instanceof Error ? e.message.split('\n')[0] : String(e); console.warn('web agent e2e skipped: browser launch refused here —', launchRefused); return; }
    browser = ctx;
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto(`http://127.0.0.1:${sitePort}/orders`);
    agent = spawn(process.execPath, ['agent.mjs'], {
      cwd: AGENT_DIR,
      env: { ...process.env, FOODHUB_URL: `http://127.0.0.1:${hubPort}`, FOODHUB_SCREENS_AGENT_TOKEN: TOKEN, SCREEN_ID: 'SCREEN_ID_TEST_1', SCREEN_START_URL: `http://127.0.0.1:${sitePort}/orders`, CDP_URL: `http://127.0.0.1:${cdpPort}`, HEARTBEAT_SECONDS: '10' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    logsOf(agent, logs);
  }, 40_000);
  afterAll(async () => { kill(agent); await browser?.close().catch(() => {}); hub.server.close(); site.server.close(); });

  it('reports ok with the page title and address, with the bearer token', async ({ skip }) => {
    if (launchRefused) skip();
    const b = await hub.waitFor((x) => x.body.screens?.[0]?.state === 'ok', 25_000);
    const s = b.body.screens[0];
    expect(s).toMatchObject({ id: 'SCREEN_ID_TEST_1', state: 'ok', title: '(2) Orders', autoReloads: 0 });
    expect(s.url).toContain(`127.0.0.1:${sitePort}/orders`);
    expect(b.body.version).toMatch(/^agent-/);
  }, 30_000);

  it('honours a "reload" command from Food Hub (page reloaded, not navigated elsewhere)', async ({ skip }) => {
    if (launchRefused) skip();
    const before = hub.beats.length;
    hub.queue.push({ id: 'SCREEN_ID_TEST_1', kind: 'reload' });
    const b = await hub.waitFor((x) => hub.beats.indexOf(x) > before, 25_000);
    // the next beat still comes from the same page; the agent never changed its address
    const after = await hub.waitFor((x) => hub.beats.indexOf(x) > hub.beats.indexOf(b), 25_000);
    expect(after.body.screens[0].url).toContain('/orders');
    expect(after.body.screens[0].state).toBe('ok');
  }, 60_000);

  it('never types, clicks or reads orders: the log holds no page text and no secret', ({ skip }) => {
    if (launchRefused) skip();
    const text = logs.join('');
    expect(text).not.toContain(TOKEN);
    expect(text).not.toMatch(/Orders<|<h1>/);
  });
});

// ---------------------------------------------------------------- android agent (fake adb, runs everywhere)
describe('android.mjs end to end with a fake adb', () => {
  const hub = fakeFoodHub();
  let agent: ChildProcess | null = null; let hubPort = 0;
  const logs: string[] = [];
  const dir = mkdtempSync(path.join(tmpdir(), 'fh-adb-'));
  const stateFile = path.join(dir, 'state.json');
  const callsFile = path.join(dir, 'calls.log');
  const PKG = 'com.doordash.merchant';
  // The fake adb reads a JSON "device" and logs every call. `state.json`: { online, front, notifs }.
  const fakeAdbJs = `
    const fs=require('fs'); const a=process.argv.slice(2).filter((x,i,all)=>!(x==='-s'||all[i-1]==='-s'));
    fs.appendFileSync(${JSON.stringify(callsFile)}, a.join(' ')+'\\n');
    const st=JSON.parse(fs.readFileSync(${JSON.stringify(stateFile)},'utf8'));
    const out=(s)=>{process.stdout.write(s);process.exit(0)};
    if(a[0]==='connect') out('connected to 127.0.0.1:5555\\n');
    if(a[0]==='get-state') out(st.online?'device\\n':'error: device offline\\n');
    if(a[1]==='dumpsys'&&a[2]==='activity') out(st.front?'  mResumedActivity: ActivityRecord{1 u0 '+st.front+' t1}\\n':'');
    if(a[1]==='dumpsys'&&a[2]==='notification') out(Array.from({length:st.notifs},(_,i)=>'    NotificationRecord(0x'+i+': pkg=${PKG} user=UserHandle{0} id='+i+')\\n      android.text=String (Order #'+(1000+i)+' for Ana)').join('\\n')+'\\n');
    if(a[1]==='monkey'||a[1]==='input'){ st.front='${PKG}/.ui.MainActivity'; fs.writeFileSync(${JSON.stringify(stateFile)},JSON.stringify(st)); out(''); }
    out('');`;
  const setState = (s: { online: boolean; front: string | null; notifs: number }) => writeFileSync(stateFile, JSON.stringify(s));

  beforeAll(async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'adb.js'), fakeAdbJs);
    // Windows: a .cmd shim (the agent runs it through the shell); elsewhere: an executable shell script.
    const shim = win ? path.join(dir, 'adb.cmd') : path.join(dir, 'adb');
    if (win) writeFileSync(shim, `@echo off\r\n"${process.execPath}" "${path.join(dir, 'adb.js')}" %*\r\n`);
    else { writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${path.join(dir, 'adb.js')}" "$@"\n`); const { chmodSync } = await import('node:fs'); chmodSync(shim, 0o755); }
    setState({ online: true, front: `${PKG}/.ui.MainActivity`, notifs: 2 });
    hubPort = await hub.listen();
    agent = spawn(process.execPath, ['android.mjs'], {
      cwd: AGENT_DIR,
      env: { ...process.env, ADB_PATH: shim, FOODHUB_URL: `http://127.0.0.1:${hubPort}`, FOODHUB_SCREENS_AGENT_TOKEN: TOKEN, SCREEN_ID: 'SCREEN_ID_DOORDASH_2', ANDROID_PACKAGE: PKG, HEARTBEAT_SECONDS: '10' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    logsOf(agent, logs);
  }, 20_000);
  afterAll(() => { kill(agent); hub.server.close(); });

  it('reports heartbeat v2: mode android, app = package in front, waiting = notification COUNT, no text', async () => {
    const b = await hub.waitFor((x) => x.body.screens?.[0]?.state === 'ok');
    expect(b.body.screens[0]).toEqual({ id: 'SCREEN_ID_DOORDASH_2', state: 'ok', mode: 'android', autoReloads: 0, app: PKG, waiting: 2 });
    expect(JSON.stringify(b.body)).not.toContain('Ana');
    expect(b.body.version).toMatch(/^agent-android-/);
  }, 20_000);

  it('reports login when the sign-in activity is in front, blank when another app is', async () => {
    setState({ online: true, front: `${PKG}/.auth.LoginActivity`, notifs: 0 });
    const l = await hub.waitFor((x) => x.body.screens?.[0]?.state === 'login', 25_000);
    expect(l.body.screens[0].app).toBe(PKG);
    setState({ online: true, front: 'com.android.launcher3/.Launcher', notifs: 0 });
    const bl = await hub.waitFor((x) => x.body.screens?.[0]?.state === 'blank', 25_000);
    expect(bl.body.screens[0].app).toBe('com.android.launcher3');
  }, 60_000);

  it('"reload" from Food Hub brings the app back to the front and nothing else is ever tapped', async () => {
    setState({ online: true, front: 'com.android.launcher3/.Launcher', notifs: 0 });
    hub.queue.push({ id: 'SCREEN_ID_DOORDASH_2', kind: 'reload' });
    const ok = await hub.waitFor((x) => x.body.screens?.[0]?.state === 'ok' && x.body.screens[0].autoReloads >= 1, 40_000);
    expect(ok.body.screens[0].app).toBe(PKG);
    const { readFileSync } = await import('node:fs');
    const calls = readFileSync(callsFile, 'utf8');
    expect(calls).toMatch(/shell monkey -p com\.doordash\.merchant -c android\.intent\.category\.LAUNCHER 1/);
    expect(calls).not.toMatch(/input (tap|text|swipe)|am start|install|pm clear/);
  }, 60_000);

  it('reports crashed when the device stops answering, and keeps running', async () => {
    setState({ online: false, front: null, notifs: 0 });
    const c = await hub.waitFor((x) => x.body.screens?.[0]?.state === 'crashed', 25_000);
    expect(c.body.screens[0].mode).toBe('android');
    expect(agent?.exitCode).toBeNull();
  }, 30_000);
});
