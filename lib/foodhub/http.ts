import { NextResponse } from 'next/server';

export function ok(data: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: true, ...data });
}

export function fail(message: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

/** Wraps a route handler so unexpected errors become clean JSON instead of HTML 500 pages. */
export function guard<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error), 500);
    }
  };
}

// Request bodies are read with a size cap: an unauthenticated caller could otherwise stream gigabytes into memory before
// any signature, token or field check runs (req.text() and req.json() have no limit). The caps are far above any real
// payload: platform orders weigh a few kilobytes, a full menu push or a statement import a few megabytes.
/** Platform webhooks (orders, menus, statuses) and signed-in uploads (menus, statements, imports). */
export const BODY_MAX_BYTES = 8 * 1024 * 1024;
/** Small public forms (a restaurant lead). */
export const FORM_MAX_BYTES = 64 * 1024;

export class BodyTooLargeError extends Error {
  constructor(public readonly maxBytes: number) {
    super(`Request body over ${maxBytes} bytes`);
    this.name = 'BodyTooLargeError';
  }
}

/** The body as text, like req.text() (same UTF-8 decoding, so signatures over the raw text still match), but refused
 * past `maxBytes`: first by its declared Content-Length, then while it streams (a body without one, or that lies). */
export async function readText(req: Request, maxBytes = BODY_MAX_BYTES): Promise<string> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError(maxBytes);
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new BodyTooLargeError(maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(all);
}

/** readText for a route: the text, or a 413 answer to return as is. */
export async function readTextOr413(req: Request, maxBytes = BODY_MAX_BYTES): Promise<{ text: string } | { response: Response }> {
  try {
    return { text: await readText(req, maxBytes) };
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return { response: NextResponse.json({ ok: false, error: 'Payload too large.' }, { status: 413, headers: { 'Cache-Control': 'no-store' } }) };
    }
    throw error;
  }
}

/** The JSON body, or {} when it is missing, malformed or over BODY_MAX_BYTES (every route then answers its own
 * "missing field" error, as for any empty body). */
export async function readJson(req: Request): Promise<Record<string, any>> {
  try { return JSON.parse(await readText(req)) ?? {}; } catch { return {}; }
}
