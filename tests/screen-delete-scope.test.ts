import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DELETE } from '../app/api/foodhub/screens/[id]/route';
import { hashPassword } from '../lib/foodhub/auth';
import { getRepo } from '../lib/foodhub/repo';
import { addScreen, getScreen, SCREENS, updateScreen } from '../lib/foodhub/screens';
import type { Actor } from '../lib/foodhub/activity';

const ORIGINAL = 'TEST_ORIGINAL';
const DESTINATION = 'TEST_DESTINATION';
const OWNER: Actor = { username: 'owner', name: 'Fixture owner', source: 'dashboard' };
const MANAGER = 'fixture-manager';
const PASSWORD = 'test-screen-delete-scope-password';

beforeEach(async () => {
  vi.stubEnv('FOODHUB_FORCE_MEMORY', 'true');
  vi.stubGlobal('__foodhubMem', undefined);
  await getRepo().saveUser({
    username: MANAGER, name: 'Fixture manager', role: 'manager', locations: [ORIGINAL],
    active: true, passwordHash: hashPassword(PASSWORD),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function deleteScreen(id: string) {
  const authorization = `Basic ${Buffer.from(`${MANAGER}:${PASSWORD}`).toString('base64')}`;
  const request = new Request(`http://hub.local/api/foodhub/screens/${id}`, { method: 'DELETE', headers: { authorization } });
  return DELETE(request, { params: Promise.resolve({ id }) });
}

async function fixtureScreen() {
  const screen = await addScreen({ name: 'Fixture screen', platform: 'skip', locationCode: ORIGINAL, viewUrl: 'https://relay.example.test/s01/' }, OWNER);
  if ('error' in screen) throw new Error(screen.error);
  return screen;
}

async function deleteDuringChange(id: string, change: () => Promise<unknown>) {
  const repo = getRepo();
  const getDoc = repo.getDoc.bind(repo);
  let announceRead!: () => void;
  let resume!: () => void;
  const read = new Promise<void>((resolve) => { announceRead = resolve; });
  const paused = new Promise<void>((resolve) => { resume = resolve; });
  let intercepted = false;
  const lookup = vi.spyOn(repo, 'getDoc').mockImplementation(async (collection, docId) => {
    const doc = await getDoc(collection, docId);
    if (collection === SCREENS && docId === id && !intercepted) {
      intercepted = true;
      announceRead();
      await paused;
    }
    return doc;
  });
  const deletion = deleteScreen(id);
  try {
    await Promise.race([read, deletion.then(() => { throw new Error('DELETE completed without reading the screen'); })]);
    await change();
  } finally {
    resume();
    await deletion;
    lookup.mockRestore();
  }
  return deletion;
}

it('leaves an authorized move to another kitchen intact when a source manager deletes from a stale read', async () => {
  const screen = await fixtureScreen();
  const response = await deleteDuringChange(screen.id, async () => {
    expect(await updateScreen(screen.id, { locationCode: DESTINATION }, OWNER)).toMatchObject({ locationCode: DESTINATION });
  });

  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ ok: false, error: 'Screen not found' });
  expect(await getScreen(screen.id)).toMatchObject({ id: screen.id, locationCode: DESTINATION });
});

it('does not remove a newly provisioned revision that reused the screen ID in the same kitchen', async () => {
  const screen = await fixtureScreen();
  const repo = getRepo();
  const response = await deleteDuringChange(screen.id, async () => {
    await repo.deleteDocs(SCREENS, [screen.id]);
    await repo.insertDocIfAbsent(SCREENS, {
      id: screen.id, key: ORIGINAL, at: screen.createdAt,
      data: { ...screen, name: 'Replacement screen', revision: crypto.randomUUID() },
    });
  });

  expect(response.status).toBe(404);
  expect(await getScreen(screen.id)).toMatchObject({ name: 'Replacement screen', locationCode: ORIGINAL });
});

it('protects a legacy screen moved by an older writer that does not assign revisions', async () => {
  const screen = await fixtureScreen();
  const repo = getRepo();
  await repo.putDocs(SCREENS, [{ id: screen.id, key: ORIGINAL, at: screen.createdAt, data: screen }]);
  const response = await deleteDuringChange(screen.id, () => repo.putDocs(SCREENS, [{
    id: screen.id, key: DESTINATION, at: screen.createdAt, data: { ...screen, locationCode: DESTINATION },
  }]));

  expect(response.status).toBe(404);
  expect(await getScreen(screen.id)).toMatchObject({ id: screen.id, locationCode: DESTINATION });
});

it('keeps the established response when the authorized manager removes a legacy screen', async () => {
  const screen = await fixtureScreen();
  await getRepo().putDocs(SCREENS, [{ id: screen.id, key: ORIGINAL, at: screen.createdAt, data: screen }]);

  const response = await deleteScreen(screen.id);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
  expect(await getScreen(screen.id)).toBeNull();
});
