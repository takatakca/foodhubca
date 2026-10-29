// Screens gateway (deploy/screens/gateway): one https address for every screen, framed only by Food Hub, one view
// password for all, the live view's websocket passed through.
import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM module without types
import { basicOk, frameAncestors, needsSlash, rewriteHeaders, screenOf, upstreamOf } from '../deploy/screens/gateway/gateway-lib.mjs';

describe('gateway rules', () => {
  it('routes /sNN/ to that screen only', () => {
    const screens = ['s01', 's18', 'uber-1'];
    expect(screenOf('/s01/', screens)).toBe('s01');
    expect(screenOf('/s01/websockify', screens)).toBe('s01');
    expect(screenOf('/s01', screens)).toBe('s01');
    expect(screenOf('/uber-1/x', screens)).toBe('uber-1');
    expect(screenOf('/s02/', screens)).toBeNull();
    expect(screenOf('/../s01/', screens)).toBeNull();
    expect(screenOf('/', screens)).toBeNull();
    expect(needsSlash('/s01', 's01')).toBe(true);
    expect(needsSlash('/s01/', 's01')).toBe(false);
    expect(upstreamOf('s07', '')).toEqual({ host: 's07', port: 3000 });
    expect(upstreamOf('s07', '127.0.0.1:4111')).toEqual({ host: '127.0.0.1', port: 4111 });
  });

  it('only Food Hub (https origins) may frame the screens; a bad value frames nothing', () => {
    expect(frameAncestors('https://foodhub.on2go.ca')).toBe('frame-ancestors https://foodhub.on2go.ca');
    expect(frameAncestors('https://foodhub.on2go.ca/x, https://hub2.on2go.ca')).toBe('frame-ancestors https://foodhub.on2go.ca https://hub2.on2go.ca');
    expect(frameAncestors('http://foodhub.on2go.ca')).toBe("frame-ancestors 'none'");
    expect(frameAncestors('')).toBe("frame-ancestors 'none'");
    expect(frameAncestors("https://a.ca 'unsafe-inline'")).toBe("frame-ancestors 'none'");
  });

  it('drops X-Frame-Options and the screen\'s own frame-ancestors, keeps the rest of its policy', () => {
    const p = 'frame-ancestors https://foodhub.on2go.ca';
    expect(rewriteHeaders({ 'X-Frame-Options': 'SAMEORIGIN', 'content-type': 'text/html' }, p)).toEqual({
      'content-type': 'text/html', 'content-security-policy': p, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
    });
    expect(rewriteHeaders({ 'content-security-policy': "default-src 'self'; frame-ancestors 'none'" }, p)['content-security-policy']).toBe(`default-src 'self'; ${p}`);
  });

  it('one view password for every screen (constant-time compare)', () => {
    const b = (s: string) => `Basic ${Buffer.from(s).toString('base64')}`;
    expect(basicOk(b('view:secret-pass'), 'view', 'secret-pass', crypto.timingSafeEqual)).toBe(true);
    expect(basicOk(b('view:wrong-pass'), 'view', 'secret-pass', crypto.timingSafeEqual)).toBe(false);
    expect(basicOk(undefined, 'view', 'secret-pass', crypto.timingSafeEqual)).toBe(false);
    expect(basicOk('Bearer x', 'view', 'secret-pass', crypto.timingSafeEqual)).toBe(false);
    expect(basicOk(undefined, 'view', '', crypto.timingSafeEqual)).toBe(true); // not configured: the screens' own sign-in still asks
  });
});

describe('gateway end to end (a fake screen with a websocket)', () => {
  let screen: http.Server; let gw: ChildProcess; let gwPort = 0; let seen: { path?: string; auth?: string } = {};
  const free = () => new Promise<number>((r) => { const s = net.createServer().listen(0, () => { const p = (s.address() as net.AddressInfo).port; s.close(() => r(p)); }); });
  const auth = `Basic ${Buffer.from('view:secret-pass').toString('base64')}`;

  beforeAll(async () => {
    screen = http.createServer((req, res) => {
      seen = { path: req.url, auth: req.headers.authorization };
      res.writeHead(200, { 'content-type': 'text/html', 'x-frame-options': 'DENY' });
      res.end('<html>screen view</html>');
    });
    screen.on('upgrade', (req, socket) => {
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
      socket.on('data', (d) => socket.write(Buffer.concat([Buffer.from('echo:'), d])));
    });
    await new Promise<void>((r) => screen.listen(0, r));
    gwPort = await free();
    gw = spawn(process.execPath, [path.join(__dirname, '../deploy/screens/gateway/gateway.mjs')], {
      env: { ...process.env, PORT: String(gwPort), SCREENS: 's01,s02', FOODHUB_ORIGIN: 'https://foodhub.on2go.ca', SCREENS_VIEW_USER: 'view', SCREENS_VIEW_PASSWORD: 'secret-pass', GATEWAY_UPSTREAM: `127.0.0.1:${(screen.address() as net.AddressInfo).port}` },
      stdio: 'ignore',
    });
    for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://127.0.0.1:${gwPort}/healthz`)).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 100)); }
  });
  afterAll(() => { gw?.kill(); screen?.close(); });

  it('health without a password; a screen needs the view password; unknown paths are 404', async () => {
    expect((await fetch(`http://127.0.0.1:${gwPort}/healthz`)).status).toBe(200);
    const anon = await fetch(`http://127.0.0.1:${gwPort}/s01/`);
    expect(anon.status).toBe(401);
    expect(anon.headers.get('www-authenticate')).toMatch(/Basic/);
    expect((await fetch(`http://127.0.0.1:${gwPort}/s99/`, { headers: { authorization: auth } })).status).toBe(404);
    const slash = await fetch(`http://127.0.0.1:${gwPort}/s01?x=1`, { headers: { authorization: auth }, redirect: 'manual' });
    expect(slash.status).toBe(301);
    expect(slash.headers.get('location')).toBe('/s01/?x=1');
  });

  it('passes the screen through with its path kept, framed only by Food Hub', async () => {
    const r = await fetch(`http://127.0.0.1:${gwPort}/s01/vnc.html?a=1`, { headers: { authorization: auth } });
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('<html>screen view</html>');
    expect(seen.path).toBe('/s01/vnc.html?a=1');
    expect(seen.auth).toBe(auth); // forwarded: the screen's own sign-in uses the same view password, asked once
    expect(r.headers.get('x-frame-options')).toBeNull();
    expect(r.headers.get('content-security-policy')).toBe('frame-ancestors https://foodhub.on2go.ca');
  });

  it('passes the live view\'s websocket both ways, and refuses it without the password', async () => {
    const talk = (withAuth: boolean) => new Promise<string>((resolve) => {
      const s = net.connect(gwPort, '127.0.0.1', () => {
        s.write(`GET /s02/websockify HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n${withAuth ? `Authorization: ${auth}\r\n` : ''}\r\n`);
      });
      let got = '';
      s.on('data', (d) => { got += d.toString(); if (got.includes('101') && !got.includes('echo:')) s.write('ping'); if (got.includes('echo:ping') || got.includes('401')) { s.end(); resolve(got); } });
      s.on('end', () => resolve(got));
      setTimeout(() => { s.destroy(); resolve(got); }, 3000);
    });
    const ok = await talk(true);
    expect(ok).toContain('101 Switching Protocols');
    expect(ok).toContain('echo:ping');
    expect(await talk(false)).toContain('401');
  });
});
