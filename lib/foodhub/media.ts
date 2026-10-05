// Menu photos uploaded from Food Hub (instead of pasting a link).
// Files are stored on the server's disk (FOODHUB_MEDIA_DIR, default ./data/media — on the VPS install that folder
// survives restarts and updates) and served publicly at /media/<name>, because Uber Eats, DoorDash and Skip download
// the photo from that address. Names are the content hash, so the same photo is stored once.
// On serverless hosting (no lasting disk), keep using photo links.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { publicBaseUrl } from './config';

export const MEDIA_MAX_BYTES = 5 * 1024 * 1024;
export const MEDIA_NAME_RE = /^[a-f0-9]{24}\.(jpg|png|webp)$/;
const TYPES: Record<string, { ext: 'jpg' | 'png' | 'webp'; mime: string }> = {
  jpeg: { ext: 'jpg', mime: 'image/jpeg' },
  png: { ext: 'png', mime: 'image/png' },
  webp: { ext: 'webp', mime: 'image/webp' },
};

export function mediaDir(): string {
  return process.env.FOODHUB_MEDIA_DIR || path.join(process.cwd(), 'data', 'media');
}

export function mimeFor(name: string): string {
  return name.endsWith('.png') ? 'image/png' : name.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
}

/** Image type and size read from the file itself (never trust the file name or the browser's type). */
export function imageInfo(buf: Buffer): { type: keyof typeof TYPES; width: number; height: number } | null {
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) {
    return { type: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length >= 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return { type: 'webp', width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (chunk === 'VP8 ' && buf.length >= 30) return { type: 'webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L' && buf.length >= 25) {
      const b = buf.readUInt32LE(21);
      return { type: 'webp', width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
    }
    return null;
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { i += marker === 0xff ? 1 : 2; continue; } // padding / markers without a length
      const len = buf.readUInt16BE(i + 2);
      // SOF0..SOF15 except DHT (C4), JPG (C8), DAC (CC) carry the size
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { type: 'jpeg', height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
    return { type: 'jpeg', width: 0, height: 0 };
  }
  return null;
}

export type SaveImageResult =
  | { ok: true; name: string; url: string; width: number; height: number; warning?: string }
  | { ok: false; error: string };

export async function saveImage(buf: Buffer): Promise<SaveImageResult> {
  if (!buf.length) return { ok: false, error: 'The file is empty.' };
  if (buf.length > MEDIA_MAX_BYTES) return { ok: false, error: 'The photo is larger than 5 MB.' };
  const info = imageInfo(buf);
  if (!info) return { ok: false, error: 'Use a JPG, PNG or WebP photo.' };
  const t = TYPES[info.type];
  const name = `${crypto.createHash('sha256').update(buf).digest('hex').slice(0, 24)}.${t.ext}`;
  const dir = mediaDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), buf);
  const small = info.width > 0 && (info.width < 600 || info.height < 400);
  return {
    ok: true, name, url: `${publicBaseUrl()}/media/${name}`, width: info.width, height: info.height,
    ...(small ? { warning: `The photo is ${info.width}×${info.height}. Delivery apps prefer at least 1200×800 — it may be refused or look blurry.` } : {}),
  };
}

export async function readImage(name: string): Promise<Buffer | null> {
  if (!MEDIA_NAME_RE.test(name)) return null;
  try { return await fs.readFile(path.join(mediaDir(), name)); } catch { return null; }
}
