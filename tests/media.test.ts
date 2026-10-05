// Menu photo upload: type and size come from the file bytes; stored by content hash; served by name only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { imageInfo, readImage, saveImage } from '../lib/foodhub/media';

function png(width: number, height: number) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'ascii'); b.writeUInt32BE(width, 16); b.writeUInt32BE(height, 20);
  return b;
}
function jpeg(width: number, height: number) {
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14)]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}
function webpX(width: number, height: number) {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(22, 4); b.write('WEBP', 8, 'ascii'); b.write('VP8X', 12, 'ascii');
  b.writeUIntLE(width - 1, 24, 3); b.writeUIntLE(height - 1, 27, 3);
  return b;
}

let dir = '';
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-media-'));
  process.env.FOODHUB_MEDIA_DIR = dir;
  process.env.FOODHUB_PUBLIC_URL = 'https://foodhub.example';
});

describe('menu photo upload', () => {
  it('reads the type and size from the bytes', () => {
    expect(imageInfo(png(1200, 800))).toEqual({ type: 'png', width: 1200, height: 800 });
    expect(imageInfo(jpeg(1600, 900))).toEqual({ type: 'jpeg', width: 1600, height: 900 });
    expect(imageInfo(webpX(1280, 720))).toEqual({ type: 'webp', width: 1280, height: 720 });
    expect(imageInfo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(imageInfo(Buffer.from('GIF89a......'))).toBeNull();
  });

  it('stores by content hash, returns the public URL, warns when too small', async () => {
    const r = await saveImage(jpeg(1600, 900));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.name).toMatch(/^[a-f0-9]{24}\.jpg$/);
    expect(r.url).toBe(`https://foodhub.example/media/${r.name}`);
    expect(r.warning).toBeUndefined();
    expect(fs.existsSync(path.join(dir, r.name))).toBe(true);
    expect((await saveImage(jpeg(1600, 900))).ok && (await saveImage(jpeg(1600, 900)) as any).name).toBe(r.name); // same photo, same name
    const small = await saveImage(png(300, 200));
    expect(small.ok && small.warning).toMatch(/300×200/);
  });

  it('refuses other files and never serves a path outside the folder', async () => {
    expect(await saveImage(Buffer.from('not an image'))).toEqual({ ok: false, error: 'Use a JPG, PNG or WebP photo.' });
    expect(await saveImage(Buffer.alloc(0))).toEqual({ ok: false, error: 'The file is empty.' });
    expect(await readImage('../../etc/passwd')).toBeNull();
    expect(await readImage('abc.jpg')).toBeNull();
    const r = await saveImage(png(1200, 800));
    expect(r.ok && (await readImage(r.name))?.length).toBe(33);
  });
});
