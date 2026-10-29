import { describe, expect, it } from 'vitest';
import {
  MAX_WEBSITE_ORDER_BYTES,
  readWebsiteOrderBody,
  WebsiteOrderBodyTooLargeError,
} from '../lib/foodhub/delivery/website-body';

const url = 'https://foodhub.on2go.ca/api/foodhub/webhooks/website-order';

describe('first-party website-order body boundary', () => {
  it('accepts a small UTF-8 JSON payload unchanged', async () => {
    const data = JSON.stringify({ id: 'W1', name: 'Montréal' });
    const req = new Request(url, { method: 'POST', body: data });
    expect(await readWebsiteOrderBody(req)).toBe(data);
  });

  it('refuses declared over-limit payloads before processing the body', async () => {
    const req = new Request(url, {
      method: 'POST',
      headers: { 'content-length': String(MAX_WEBSITE_ORDER_BYTES + 1) },
      body: '{}',
    });
    await expect(readWebsiteOrderBody(req)).rejects.toBeInstanceOf(WebsiteOrderBodyTooLargeError);
  });

  it('refuses a streamed over-limit payload even with no Content-Length', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_WEBSITE_ORDER_BYTES));
        controller.enqueue(new Uint8Array([1]));
        controller.close();
      },
    });
    const req = new Request(url, {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    await expect(readWebsiteOrderBody(req)).rejects.toBeInstanceOf(WebsiteOrderBodyTooLargeError);
  });

  it('rejects malformed Content-Length and invalid UTF-8', async () => {
    const badLength = new Request(url, {
      method: 'POST',
      headers: { 'content-length': 'infinite' },
      body: '{}',
    });
    await expect(readWebsiteOrderBody(badLength)).rejects.toThrow('Invalid Content-Length');

    const invalidBytes = new Request(url, {
      method: 'POST',
      body: new Uint8Array([255]),
    });
    await expect(readWebsiteOrderBody(invalidBytes)).rejects.toThrow();
  });
});
