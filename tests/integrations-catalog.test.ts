import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHANNEL_KEYS } from '../lib/foodhub/adapters';
import {
  INTEGRATIONS, integrationCatalog, integrationStatus, integrationSummary, outreachQueue, publicIntegrations, type IntegrationStatus,
} from '../lib/foodhub/integrations/catalog';
import { HUB_PLATFORMS } from '../lib/foodhub/pricing';

// The integration catalogue (docs/INTEGRATION_PLATFORM.md): honest states, one email per partner, code that exists.

const STATUSES: IntegrationStatus[] = ['live', 'certification', 'built', 'outreach', 'to_request'];
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
    for (const r of outreachQueue(['uber'])) expect(['to_request', 'outreach']).toContain(r.status);
    expect(outreachQueue(['uber']).map((r) => r.id)).toEqual(expect.arrayContaining(['square', 'toast', 'lightspeed', 'trexity']));
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
