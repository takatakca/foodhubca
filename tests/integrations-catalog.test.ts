import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHANNEL_KEYS } from '../lib/foodhub/adapters';
import {
  INTEGRATIONS, integrationCatalog, integrationStatus, integrationSummary, outreachQueue, outreachStateOf, publicIntegrations, type Integration,
  type IntegrationStatus,
} from '../lib/foodhub/integrations/catalog';
import { HUB_PLATFORMS } from '../lib/foodhub/pricing';

// The integration catalogue (docs/INTEGRATION_PLATFORM.md): honest states, one email per partner, code that exists.

const STATUSES: IntegrationStatus[] = ['live', 'certification', 'built', 'to_request'];
const OUTREACH = readFileSync('docs/PARTNER_OUTREACH.md', 'utf8');

/** A `code` path exists: a file, or a glob like lib/x/uber-*.ts / lib/x/* with at least one match. */
function codeExists(path: string): boolean {
  if (!path.includes('*')) return existsSync(path);
  const dir = dirname(path);
  const re = new RegExp(`^${path.slice(dir.length + 1).replace(/\./g, '\\.').replace(/\*/g, '.*')}$`);
  return existsSync(dir) && readdirSync(dir).some((f) => re.test(f) && existsSync(join(dir, f)));
}

describe('integration catalogue (lib/foodhub/integrations/catalog.ts)', () => {
  it('has unique ids, a known state, and an entry point for every partner', () => {
    expect(new Set(INTEGRATIONS.map((r) => r.id)).size).toBe(INTEGRATIONS.length);
    for (const r of INTEGRATIONS) {
      expect(STATUSES, r.id).toContain(r.status);
      expect(r.entry.length, r.id).toBeGreaterThan(5);
      expect(r.entry, r.id).not.toMatch(/@/); // never a person's address in this public repository
    }
  });
  it('every Food Hub channel adapter is in the catalogue, and every listed adapter exists', () => {
    const listed = INTEGRATIONS.flatMap((r) => (r.channelKey ? [r.channelKey] : []));
    expect([...listed].sort()).toEqual([...CHANNEL_KEYS].sort());
  });
  it('code paths exist; rows still to request have no code', () => {
    for (const r of INTEGRATIONS) {
      if (r.code) expect(codeExists(r.code), `${r.id}: ${r.code}`).toBe(true);
      if (r.status === 'to_request') expect(r.code, r.id).toBeUndefined();
    }
  });
  it('every outreach id has its ready email in docs/PARTNER_OUTREACH.md, and every email there has a row', () => {
    for (const r of INTEGRATIONS) if (r.outreach) expect(OUTREACH, `${r.id} → ${r.outreach}`).toMatch(new RegExp(`^### ${r.outreach}\\. `, 'm'));
    const sections = [...OUTREACH.matchAll(/^### ([A-C]\d)\. /gm)].map((m) => m[1]);
    expect(sections.length).toBeGreaterThanOrEqual(17);
    for (const s of sections) expect(INTEGRATIONS.some((r) => r.outreach === s), s).toBe(true);
  });
  it('every email is complete and ready to send: a subject and a quoted body, never a pointer to another email', () => {
    const sections = OUTREACH.split(/\n(?=### [A-C]\d\. )/).filter((s) => /^### [A-C]\d\. /.test(s));
    for (const sec of sections) {
      const id = sec.slice(4, 6);
      const body = sec.split('\n---')[0];
      expect(body, `${id} subject`).toMatch(/^\*\*(Subject|Objet \/ Subject):\*\* .+/m);
      expect(body.split('\n').filter((l) => l.startsWith('> ') && l.length > 30).length, `${id} body`).toBeGreaterThanOrEqual(3);
      expect(body, `${id} pointer`).not.toMatch(/même texte que|same text as/i);
    }
  });
  it('the partner emails never claim more about data location than the privacy policy (database in Montréal only)', () => {
    expect(OUTREACH).not.toMatch(/data (stays|remains|is kept) in canada|with data in canada|données (restent )?au canada/i);
    expect(readFileSync('app/legal/privacy/page.tsx', 'utf8')).toContain('The database is hosted in Montréal (Canada).');
  });
  it('the three hub platforms follow the public live switch, never this file', () => {
    expect(INTEGRATIONS.filter((r) => r.hubPlatform).map((r) => r.hubPlatform).sort()).toEqual([...HUB_PLATFORMS].sort());
    const uber = INTEGRATIONS.find((r) => r.id === 'uber_eats')!;
    expect(integrationStatus(uber, ['uber'])).toBe('live');
    expect(integrationStatus(uber, ['doordash'])).toBe('certification');
    const byDefault = integrationCatalog(['uber']);
    expect(byDefault.find((r) => r.id === 'doordash')!.status).toBe('certification');
    expect(integrationCatalog(['uber', 'doordash', 'skip']).find((r) => r.id === 'skip')!.status).toBe('live');
  });
  it('a public page gets live rows only; the outreach queue holds what waits on the owner', () => {
    const pub = publicIntegrations(['uber']).map((r) => r.id);
    expect(pub).toEqual(expect.arrayContaining(['uber_eats', 'clover', 'on2go_direct']));
    expect(pub).not.toContain('doordash');
    expect(pub).not.toContain('square');
  });
  it('outreach progress is separate from the technical state: every unsent email is in the queue, live platforms included', () => {
    const queue = outreachQueue(['uber']);
    const sections = [...OUTREACH.matchAll(/^### ([A-C]\d)\. /gm)].map((m) => m[1]);
    expect(queue.map((r) => r.outreach).sort()).toEqual([...sections].sort()); // one row per email, none sent yet
    expect(queue.map((r) => r.id)).toEqual(expect.arrayContaining(['uber_eats', 'doordash', 'clover', 'square', 'trexity']));
    const sent: Integration = { ...INTEGRATIONS.find((r) => r.id === 'square')!, outreachState: 'sent' };
    const answered: Integration = { ...sent, outreachState: 'answered' };
    expect(outreachStateOf(sent)).toBe('sent');
    expect(outreachStateOf(answered)).toBe('answered');
    expect(outreachStateOf(INTEGRATIONS.find((r) => r.id === 'on2go_direct')!)).toBeUndefined();
    expect(integrationStatus(answered)).toBe('to_request'); // an answer does not change what works
  });
  it('the summary counts every row once', () => {
    const s = integrationSummary(['uber']);
    const total = Object.values(s).flatMap((byStatus) => Object.values(byStatus)).reduce((a, b) => a + (b ?? 0), 0);
    expect(total).toBe(INTEGRATIONS.length);
    expect(s.pos.live).toBe(1); // Clover
  });
  it('the outreach emails keep the platform rule: a delivery platform email names no other delivery platform', () => {
    const platforms: Record<string, string[]> = {
      A1: ['Uber'], A2: ['DoorDash', 'Dasher'], A3: ['Skip', 'JET'], A4: ['Too Good To Go'], A5: ['Ritual'], A6: ['Fantuan'], A7: ['HungryPanda', 'A6'],
      B1: ['Uber'], B2: ['DoorDash', 'Dasher'], B3: ['Trexity'],
    };
    const others = ['Uber', 'DoorDash', 'SkipTheDishes', 'Too Good To Go', 'Ritual', 'Fantuan', 'HungryPanda', 'Trexity', 'Deliverect', 'Grubhub'];
    for (const [id, own] of Object.entries(platforms)) {
      const start = OUTREACH.indexOf(`### ${id}. `);
      const next = OUTREACH.indexOf('\n### ', start + 5);
      const body = OUTREACH.slice(OUTREACH.indexOf('\n', start), next === -1 ? undefined : next);
      for (const name of others) {
        if (own.some((o) => name.startsWith(o) || o.startsWith(name))) continue;
        expect(body.includes(name), `${id} must not name ${name}`).toBe(false);
      }
    }
  });
});
