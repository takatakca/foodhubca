// Campaign drafts the person approved from an assistant card. A draft is only saved in Food Hub: nothing is sent to a
// platform and no money is spent (the Campaigns screen, or the platform's own portal, is where a campaign goes live).
import crypto from 'node:crypto';
import type { Actor } from '../activity';
import { getRepo } from '../repo';

export const CAMPAIGN_DRAFTS_KEY = 'assistant_campaign_drafts_v1';
const MAX_DRAFTS = 100;

export type CampaignPlatform = 'uber_eats' | 'doordash' | 'skip' | 'website' | 'all';

export interface CampaignDraft {
  brand: string;
  platform: CampaignPlatform;
  locationCode: string | null;
  title: string;
  offer: string;
  audience: string | null;
  start: string | null;
  end: string | null;
  /** Suggested daily budget in CAD (a suggestion only: nothing is charged). */
  dailyBudget: number | null;
  message: string;
}

export interface SavedCampaignDraft extends CampaignDraft {
  id: string;
  status: 'draft';
  createdAt: string;
  createdBy: string;
  via: 'assistant';
}

export async function listCampaignDrafts(): Promise<SavedCampaignDraft[]> {
  const list = await getRepo().getKv<SavedCampaignDraft[]>(CAMPAIGN_DRAFTS_KEY).catch(() => null);
  return Array.isArray(list) ? list : [];
}

export async function saveCampaignDraft(draft: CampaignDraft, actor: Actor): Promise<SavedCampaignDraft> {
  const saved: SavedCampaignDraft = { ...draft, id: crypto.randomUUID(), status: 'draft', createdAt: new Date().toISOString(), createdBy: actor.name, via: 'assistant' };
  const list = await listCampaignDrafts();
  await getRepo().setKv(CAMPAIGN_DRAFTS_KEY, [saved, ...list].slice(0, MAX_DRAFTS));
  return saved;
}
