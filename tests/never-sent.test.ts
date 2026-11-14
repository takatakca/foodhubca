// env-utils neverSent: the one list of network errors that prove a request never left. notify (texts, calls, email),
// the TAKATAK Phone minutes and the extra-brand billing all decide "safe to send again" from it.
import { describe, expect, it } from 'vitest';
import { networkErrorCode, neverSent } from '../lib/foodhub/env-utils';

const fetchFailed = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(code), { code }) });

describe('neverSent', () => {
  it('true only for errors raised before a connection was made', () => {
    for (const code of ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ERR_INVALID_URL', 'UND_ERR_CONNECT_TIMEOUT']) {
      expect(neverSent(fetchFailed(code))).toBe(true);
      expect(neverSent(Object.assign(new Error(code), { code }))).toBe(true);
    }
  });

  it('a timeout, a dropped connection or an unknown error may have been received: false', () => {
    expect(neverSent(new DOMException('This operation was aborted', 'AbortError'))).toBe(false);
    expect(neverSent(Object.assign(new Error('timed out'), { name: 'TimeoutError', code: 'ECONNREFUSED' }))).toBe(false);
    for (const code of ['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT']) expect(neverSent(fetchFailed(code))).toBe(false);
    expect(neverSent(new TypeError('fetch failed'))).toBe(false);
    expect(neverSent(null)).toBe(false);
    expect(neverSent('boom')).toBe(false);
  });

  it('networkErrorCode reads fetch\'s cause first, then the error itself', () => {
    expect(networkErrorCode(fetchFailed('ECONNRESET'))).toBe('ECONNRESET');
    expect(networkErrorCode(Object.assign(new Error('x'), { code: 'EAI_AGAIN' }))).toBe('EAI_AGAIN');
    expect(networkErrorCode(new Error('x'))).toBe('');
    expect(networkErrorCode(undefined)).toBe('');
  });
});
