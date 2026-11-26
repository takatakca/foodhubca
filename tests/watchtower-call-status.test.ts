import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../app/api/foodhub/messages/call-status/route';
import { hashPassword } from '../lib/foodhub/auth';
import { OUTBOX, type OutboxEntry } from '../lib/foodhub/notify';
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
  vi.stubEnv('TWILIO_BASE_URL', BASE_URL);
  (globalThis as any).__foodhubMem = undefined;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
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
      { channel: 'sms' as const }, { incidentId: undefined }, { skipped: true }, { ok: false },
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
