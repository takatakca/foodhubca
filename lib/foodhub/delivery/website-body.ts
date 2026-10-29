/**
 * Bound first-party website order JSON before parsing or dispatching.
 * This protects the endpoint if delivery is enabled; it does not authorize
 * caller-supplied price/paid fields or enable PPP → Food Hub transport.
 */
export const MAX_WEBSITE_ORDER_BYTES = 128 * 1024;

export class WebsiteOrderBodyTooLargeError extends Error {
  constructor() {
    super('Website order payload exceeds the 128 KiB limit');
    this.name = 'WebsiteOrderBodyTooLargeError';
  }
}

export async function readWebsiteOrderBody(
  request: Request,
  maxBytes = MAX_WEBSITE_ORDER_BYTES,
): Promise<string> {
  const declared = request.headers.get('content-length');
  if (declared !== null) {
    const bytes = Number(declared);
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('Invalid Content-Length');
    if (bytes > maxBytes) throw new WebsiteOrderBodyTooLargeError();
  }

  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new WebsiteOrderBodyTooLargeError();
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(output);
}
