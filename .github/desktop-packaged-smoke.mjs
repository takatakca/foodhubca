import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const executable = resolve(process.argv[2] ?? 'dist/ON2GO-Hub-win32-x64/ON2GO-Hub.exe');
const profile = await mkdtemp(join(tmpdir(), 'on2go-fixture-'));
const controllerTimeout = 10_000;

async function awaitCondition(verify, description) {
  const deadline = Date.now() + controllerTimeout;
  do {
    const value = await verify();
    if (value) return value;
    await delay(100);
  } while (Date.now() < deadline);
  throw new Error(`Did not observe ${description}`);
}

// The only reachable proxy rejects requests, including the one that boots Electron before inspection attaches.
const proxy = createServer((socket) => {
  socket.on('error', () => {});
  socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
});
await new Promise((listen) => proxy.listen(0, '127.0.0.1', listen));
const linuxHeadless = process.platform === 'linux' ? ['--ozone-platform=headless', '--disable-gpu', '--disable-dev-shm-usage', '--no-sandbox'] : [];
const child = spawn(executable, [
  `--user-data-dir=${profile}`, '--inspect=127.0.0.1:0',
  `--proxy-server=http://127.0.0.1:${proxy.address().port}`, '--proxy-bypass-list=<-loopback>', ...linuxHeadless,
], { stdio: ['ignore', 'ignore', 'pipe'] });
let startupError;
let diagnostics = '';
child.on('error', (error) => { startupError = error; });
child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => { diagnostics = (diagnostics + chunk).slice(-8000); });
let socket;
let nextId = 0;
const pending = new Map();

function attach(endpoint) {
  assert.match(endpoint, /^ws:\/\/127\.0\.0\.1:\d+\/[0-9a-f-]+$/i);
  return new Promise((accept, reject) => {
    socket = new WebSocket(endpoint);
    socket.addEventListener('open', accept, { once: true });
    socket.addEventListener('error', () => reject(new Error('Could not connect to the loopback Electron inspector')), { once: true });
    socket.addEventListener('message', ({ data }) => {
      const response = JSON.parse(data);
      pending.get(response.id)?.(response);
    });
  });
}

async function evaluate(expression) {
  const id = ++nextId;
  return new Promise((accept, reject) => {
    const finish = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Electron inspector did not answer'));
    }, controllerTimeout);
    pending.set(id, ({ result, error }) => {
      clearTimeout(finish);
      pending.delete(id);
      const failure = result?.exceptionDetails?.exception?.description ?? result?.exceptionDetails?.text ?? error?.message;
      if (failure) reject(new Error(failure));
      else accept(result?.result?.value);
    });
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });
}

// These helpers execute in the packaged main process. The fixture never fetches the network.
function installFixture() {
  const { BrowserWindow, Menu } = process.mainModule.require('electron');
  const window = BrowserWindow.getAllWindows()[0];
  const contents = window.webContents;
  const routes = new Set(['/orders', '/orders/fixture', '/kitchen', '/settings']);
  const state = { online: true, hits: [], unexpected: [] };
  contents.session.protocol.handle('https', (request) => {
    const url = new URL(request.url);
    if (url.origin !== 'https://foodhub.on2go.ca' || !routes.has(url.pathname)) {
      state.unexpected.push(url.pathname);
      return new Response('Unexpected fixture request', { status: 404 });
    }
    if (!state.online) return Response.error();
    state.hits.push(url.pathname + url.search);
    return new Response('<!doctype html><title>ON2GO Hub fixture</title><main>Desktop operator fixture</main>', {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    });
  });
  globalThis.on2goSmoke = {
    state, contents,
    click(labels) {
      const menu = Menu.getApplicationMenu().items[0].submenu.items;
      const item = menu.find(({ label }) => labels.includes(label));
      if (!item) throw new Error(`Menu entry absent: ${labels.join('/')}`);
      item.click({}, window, contents);
    },
  };
  return window.isVisible();
}

const inspectWindow = `(() => {
  const contents = process.mainModule?.require('electron').BrowserWindow.getAllWindows()[0]?.webContents;
  return contents && !contents.isLoadingMainFrame() ? contents.getURL() : null;
})()`;
const isOffline = (url) => typeof url === 'string' && /^file:.*\/offline-(en|fr)\.html$/i.test(url);
const click = (labels) => evaluate(`on2goSmoke.click(${JSON.stringify(labels)})`);
const retry = () => click(['Réessayer la connexion', 'Retry connection']);
const navigateWithin = (source) => evaluate(`on2goSmoke.contents.executeJavaScript(${JSON.stringify(source)})`);
const hitsFor = (path) => evaluate(`on2goSmoke.state.hits.filter((hit) => hit === ${JSON.stringify(path)}).length`);

async function visit(path, action) {
  const before = await hitsFor(path);
  await action();
  await awaitCondition(async () => {
    const actual = await evaluate(inspectWindow);
    return actual === `https://foodhub.on2go.ca${path}` && await hitsFor(path) > before
      && await navigateWithin('document.title') === 'ON2GO Hub fixture';
  }, `a new successful load of ${path}`);
}

try {
  const endpoint = await awaitCondition(() => {
    if (startupError || child.exitCode !== null) throw startupError ?? new Error(`${basename(executable)} exited with ${child.exitCode}`);
    return diagnostics.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[0-9a-f-]+)/i)?.[1];
  }, 'the loopback Electron inspector');
  await attach(endpoint);
  await awaitCondition(async () => isOffline(await evaluate(inspectWindow)), 'the offline page with external networking unavailable');
  assert.equal(await evaluate(`(${installFixture})()`), true, 'The app opened a visible native window');
  await visit('/orders', retry);
  await visit('/kitchen', () => click(['Cuisine', 'Kitchen']));
  await visit('/settings', () => click(['Réglages', 'Settings']));
  await visit('/orders', () => click(['Commandes', 'Orders']));

  const inPageRoute = '/orders/fixture?source=desktop';
  await navigateWithin(`history.pushState({}, '', ${JSON.stringify(inPageRoute)})`);
  await awaitCondition(async () => await evaluate(inspectWindow) === `https://foodhub.on2go.ca${inPageRoute}`, 'the same-document order route');
  await visit(inPageRoute, retry);
  const hitsBeforeLoss = await evaluate('on2goSmoke.state.hits.length');
  await evaluate('on2goSmoke.state.online = false');
  await retry();
  await awaitCondition(async () => isOffline(await evaluate(inspectWindow)), 'the offline page after a simulated network loss');
  await evaluate('on2goSmoke.state.online = true');
  await visit(inPageRoute, retry);
  assert.equal(await evaluate('on2goSmoke.state.hits.length'), hitsBeforeLoss + 1);
  assert.equal(await navigateWithin("window.open('https://external.fixture.invalid/') === null"), true);
  assert.deepEqual(await evaluate('on2goSmoke.state.unexpected'), []);
  console.log('Packaged ON2GO Hub opened a native window, used Orders, Kitchen and Settings, and restored the exact in-page route after network loss.');
} finally {
  socket?.close();
  if (child.exitCode === null && child.pid) {
    const exited = new Promise((done) => child.once('exit', done));
    child.kill();
    await Promise.race([exited, delay(2000)]);
  }
  proxy.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 4 });
}
