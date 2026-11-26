import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../app/api/foodhub/messages/call-status/route';
import { hashPassword } from '../lib/foodhub/auth';
import { runDry, type DryRun } from '../lib/foodhub/dry-run';
import { listOutbox, OUTBOX, placeCall, type OutboxEntry } from '../lib/foodhub/notify';
import { getRepo } from '../lib/foodhub/repo';

const ID = '00000000-0000-4000-8000-000000000001';
const SID = `CA${'a'.repeat(32)}`;
const OTHER_SID = `CA${'b'.repeat(32)}`;
const ACCOUNT = `AC${'1'.repeat(32)}`;
const PASSWORD = 'test-owner-password';
const BASE_URL = 'https://twilio.example.test';

const fetchMock = vi.fn<typeof fetch>();

function request(query = `?id=${ID}`, username: string | null = 'owner') {
  const headers = username ? { authorization: `Basic ${Buffer.from(`${username}:${PASSWORD}`).toString('base64')}` } : undefined;
  return GET(new Request(`http://hub.local/api/foodhub/messages/call-status${query}`, { headers }), undefined);
}

async function saveAlertCall(patch: Partial<OutboxEntry> = {}) {
  const at = new Date().toISOString();
  const row: OutboxEntry = {
    id: ID, at, channel: 'call', to: 'masked-recipient', purpose: 'alert_shared_screen',
    ok: true, message: 'Calling', ref: SID, incidentId: 'test-incident', ...patch,
  };
  await getRepo().putDocs(OUTBOX, [{ id: ID, at, key: 'test-incident', data: row }]);
}

beforeEach(() => {
  vi.stubEnv('FOODHUB_FORCE_MEMORY', 'true');
  vi.stubEnv('DASHBOARD_PASSWORD', PASSWORD);
  vi.stubEnv('TWILIO_ACCOUNT_SID', ACCOUNT);
  vi.stubEnv('TWILIO_AUTH_TOKEN', 'test-token');
  vi.stubEnv('TWILIO_FROM', '+15145550100');
  vi.stubEnv('TWILIO_BASE_URL', BASE_URL);
  (globalThis as any).__foodhubMem = undefined;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Watchtower call confirmation', () => {
  const alertCall = () => placeCall({ to: '+15145550124', say: 'Test alert' }, { purpose: 'alert_shared_screen', incidentId: 'test-incident' });

  it('saves an accepted call and the provider reference for its existing status lookup', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ sid: SID, status: 'queued' }, { status: 201 }));
    expect(await alertCall()).toMatchObject({ ok: true, ref: SID });
    const [entry] = await listOutbox();
    expect(entry).toMatchObject({ ok: true, ref: SID, incidentId: 'test-incident', to: '+1••••••0124' });
    expect(entry).not.toHaveProperty('uncertain');
    fetchMock.mockResolvedValueOnce(Response.json({ sid: SID, status: 'no-answer' }));
    expect(await (await request(`?id=${entry.id}`)).json()).toEqual({ ok: true, status: 'no-answer' });
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'GET']);
  });

  it.each([
    ['a missing reference', () => Response.json({}, { status: 201 })],
    ['an invalid reference', () => Response.json({ sid: `${SID}/not-a-call` }, { status: 201 })],
    ['a malformed response', () => new Response('<html>fixture</html>', { status: 200 })],
  ] as const)('leaves the outcome unconfirmed when a 2xx reply has %s', async (_label, response) => {
    fetchMock.mockResolvedValueOnce(response());
    const result = await alertCall();
    expect(result).toEqual({ ok: false, channel: 'call', message: 'Twilio did not confirm the call reference.', uncertain: true });
    const [entry] = await listOutbox();
    expect(entry).toMatchObject({ ok: false, uncertain: true, message: result.message });
    expect(entry).not.toHaveProperty('ref');
    expect((await request(`?id=${entry.id}`)).status).toBe(404);
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['POST']);
  });

  it('persists an ambiguous network failure as unconfirmed with no new request', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('Test connection interrupted', 'TimeoutError'));
    expect(await alertCall()).toMatchObject({ ok: false, uncertain: true });
    expect(await listOutbox()).toMatchObject([{ channel: 'call', ok: false, uncertain: true }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retains the result of a known provider refusal and a network failure before sending', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ message: 'Test refusal' }, { status: 400 }))
      .mockRejectedValueOnce(new Error('Test connection refused', { cause: { code: 'ECONNREFUSED' } }));
    for (const message of ['Twilio HTTP 400: Test refusal', 'Network error: Test connection refused']) {
      const result = await alertCall();
      expect(result).toEqual({ ok: false, channel: 'call', message });
    }
    const entries = await listOutbox();
    expect(entries).toHaveLength(2);
    for (const entry of entries) expect(entry).not.toHaveProperty('uncertain');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps simulated calls in the dry-run context', async () => {
    const dry: DryRun = { sent: [] };
    expect(await runDry(dry, alertCall)).toMatchObject({ ok: true, ref: 'simulated' });
    expect(dry.sent).toMatchObject([{ channel: 'call', purpose: 'alert_shared_screen' }]);
    expect(await listOutbox()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Watchtower call status', () => {
  it.each(['completed', 'failed', 'no-answer'])('returns only the recorded call status for %s', async (status) => {
    await saveAlertCall();
    fetchMock.mockResolvedValueOnce(Response.json({ sid: SID, status, to: 'private-provider-recipient', from: 'private-provider-caller', customer: 'private-provider-note' }));
    const response = await request(`?id=${ID}&sid=${OTHER_SID}`);

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ ok: true, status });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      `${BASE_URL}/2010-04-01/Accounts/${ACCOUNT}/Calls/${SID}.json`,
      expect.objectContaining({ method: 'GET', redirect: 'error', headers: { Authorization: expect.stringMatching(/^Basic /) } }),
    );
  });

  it('returns a generic error for provider failures or a response that cannot verify the recorded call', async () => {
    await saveAlertCall();
    fetchMock
      .mockResolvedValueOnce(Response.json({ message: 'private-provider-error' }, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ sid: SID, status: 'unrecognized-provider-status' }))
      .mockResolvedValueOnce(Response.json({ sid: OTHER_SID, status: 'completed' }));
    for (let i = 0; i < 3; i++) {
      const response = await request();
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ ok: false, error: 'Twilio call status is unavailable.' });
    }
  });

  it('does not contact Twilio for unauthenticated, non-admin or location-scoped users', async () => {
    await saveAlertCall();
    const passwordHash = hashPassword(PASSWORD);
    await getRepo().saveUser({ username: 'test-manager', name: 'Test manager', role: 'manager', locations: [], active: true, passwordHash });
    await getRepo().saveUser({ username: 'scoped-owner', name: 'Scoped owner', role: 'owner', locations: ['TEST'], active: true, passwordHash });

    expect((await request(undefined, null)).status).toBe(401);
    expect((await request(undefined, 'test-manager')).status).toBe(403);
    expect((await request(undefined, 'scoped-owner')).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not contact Twilio with a supplied SID or an invalid, missing, simulated or unrelated entry', async () => {
    expect((await request(`?sid=${SID}`)).status).toBe(400);
    expect((await request('?id=invalid')).status).toBe(400);
    expect((await request()).status).toBe(404);
    for (const patch of [
      { ref: `${SID}/recordings` }, { ref: 'simulated' }, { purpose: 'unrelated' },
      { channel: 'sms' as const }, { incidentId: undefined }, { skipped: true }, { ok: false }, { uncertain: true },
    ]) {
      await saveAlertCall(patch);
      expect((await request()).status).toBe(404);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not contact Twilio when call status credentials are missing', async () => {
    await saveAlertCall();
    vi.stubEnv('TWILIO_AUTH_TOKEN', undefined);
    expect((await request()).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
