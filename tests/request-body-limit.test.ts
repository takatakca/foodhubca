import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BODY_MAX_BYTES, BodyTooLargeError, readJson, readText, readTextOr413 } from '../lib/foodhub/http';

// Request bodies are read with a cap (lib/foodhub/http.ts): an unauthenticated caller could otherwise stream gigabytes
// into memory before any signature or token check. Found by the full diagnostic of 2026-11-18.

const URL_ = 'https://foodhub.on2go.ca/api/foodhub/webhooks/x';
const post = (body: BodyInit, headers: Record<string, string> = {}) => new Request(URL_, { method: 'POST', body, headers, duplex: 'half' } as RequestInit & { duplex: 'half' });
const stream = (sizes: number[]) => new ReadableStream<Uint8Array>({
  start(c) { for (const n of sizes) c.enqueue(new Uint8Array(n).fill(0x61)); c.close(); },
});

describe('bounded request bodies (lib/foodhub/http.ts)', () => {
  it('reads text exactly like req.text(): accents, emoji and a byte-order mark', async () => {
    for (const s of ['{"name":"Crêpe jambon gruyère","note":"sans ail 🌶"}', '﻿{"a":1}', '']) {
      expect(await readText(post(s))).toBe(await post(s).text());
    }
  });
  it('refuses a body over the cap by its Content-Length, before reading it', async () => {
    await expect(readText(post('{}', { 'content-length': String(BODY_MAX_BYTES + 1) }))).rejects.toBeInstanceOf(BodyTooLargeError);
  });
  it('refuses a streamed body over the cap even without a Content-Length', async () => {
    await expect(readText(post(stream([1024, 1024]) as unknown as BodyInit), 2000)).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(await readText(post(stream([1000, 1000]) as unknown as BodyInit), 2000)).toHaveLength(2000); // exactly the cap is fine
  });
  it('readTextOr413 answers 413 with no-store, and hands back the text otherwise', async () => {
    const big = await readTextOr413(post('x'.repeat(50)), 10);
    expect('response' in big && big.response.status).toBe(413);
    expect('response' in big && big.response.headers.get('cache-control')).toBe('no-store');
    expect(await readTextOr413(post('hello'), 10)).toEqual({ text: 'hello' });
  });
  it('readJson: the object, else {} when the body is missing, malformed or over the cap', async () => {
    expect(await readJson(post('{"username":"owner"}'))).toEqual({ username: 'owner' });
    expect(await readJson(post('not json'))).toEqual({});
    expect(await readJson(new Request(URL_, { method: 'POST' }))).toEqual({});
    expect(await readJson(post('{}', { 'content-length': String(BODY_MAX_BYTES + 1) }))).toEqual({});
  });
  it('no API route or helper reads a request body without a cap (website-order has its own in PR #104)', () => {
    const files: string[] = [];
    const walk = (dir: string) => { for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f)) files.push(p); } };
    walk('app/api');
    walk('lib');
    const unbounded = files
      .filter((f) => !f.includes(join('webhooks', 'website-order')) && f !== join('lib', 'foodhub', 'http.ts'))
      .filter((f) => /await (req|request)\.(text|json)\(\)/.test(readFileSync(f, 'utf8')));
    expect(unbounded).toEqual([]);
  });
});
