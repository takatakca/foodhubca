// Settings → Autopilot: the switches of the NEW automations, OFF until a manager or the owner turns one on. They live in
// the repo key/value store, so a switch survives a restart. The automations that existed before keep their switch where
// it already lives (tablet-off guard per kitchen, Watchtower rules, server settings): never copied here.
import { logActivity, type Actor } from '../activity';
import { nowIso } from '../config';
import { getRepo } from '../repo';

export const AUTOPILOT_SWITCHES_KEY = 'autopilot_switches_v1';
export const NEW_AUTOMATIONS = ['republish_after_change', 'retry_failed_jobs', 'uber_weekly_report'] as const;
export type NewAutomationId = (typeof NEW_AUTOMATIONS)[number];

export interface SwitchState { on: boolean; at: string; by: string }
export type Switches = Partial<Record<NewAutomationId, SwitchState>>;

const NAMES: Record<NewAutomationId, string> = {
  republish_after_change: 'Re-publish 10 min after a change',
  retry_failed_jobs: 'Retry refused sends',
  uber_weekly_report: 'Weekly Uber payment report',
};

export function isNewAutomation(id: unknown): id is NewAutomationId {
  return typeof id === 'string' && (NEW_AUTOMATIONS as readonly string[]).includes(id);
}

function clean(raw: unknown): Switches {
  const out: Switches = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const id of NEW_AUTOMATIONS) {
    const s = (raw as Record<string, unknown>)[id] as Partial<SwitchState> | undefined;
    if (s && typeof s.on === 'boolean') out[id] = { on: s.on, at: typeof s.at === 'string' ? s.at : '', by: typeof s.by === 'string' ? s.by : '' };
  }
  return out;
}

/** The stored switches. A read error counts as "every switch off": an automation never runs on a guess. */
export async function getSwitches(): Promise<Switches> {
  return clean(await getRepo().getKv<Switches>(AUTOPILOT_SWITCHES_KEY).catch(() => null));
}

export async function isSwitchOn(id: NewAutomationId): Promise<boolean> {
  return (await getSwitches())[id]?.on === true;
}

/**
 * Turns one new automation on or off (the caller checked the role) and logs who did it. The current switches are read
 * without swallowing errors, so a store that cannot be read is never overwritten with only this switch. Asking for the
 * state it already has changes nothing (the switch-on time, which bounds the retries, stays).
 *
 * OFF means nothing more happens: the retries still waiting end, the re-publishes still planned are cancelled. (Second
 * guards: the retry heartbeat drops a chain older than the switch-on time, and the scheduled publishes never run an
 * Autopilot entry while its switch is off.)
 */
export async function setSwitch(id: NewAutomationId, on: boolean, actor: Actor): Promise<SwitchState> {
  const repo = getRepo();
  const all = clean(await repo.getKv<Switches>(AUTOPILOT_SWITCHES_KEY));
  const prev = all[id];
  let state: SwitchState;
  if (prev && prev.on === on) {
    state = prev;
  } else {
    state = { on, at: nowIso(), by: actor.name };
    await repo.setKv(AUTOPILOT_SWITCHES_KEY, { ...all, [id]: state });
    await logActivity({ actor: actor.name, source: actor.source, kind: 'settings', action: 'autopilot_switch', status: 'success',
      summary: `Autopilot: “${NAMES[id]}” switched ${on ? 'ON' : 'OFF'}`, detail: { automation: id, on } });
  }
  if (!on) {
    try {
      // Loaded on demand: republish.ts reads this module's isSwitchOn.
      if (id === 'retry_failed_jobs') await (await import('./retry')).endWaitingRetries(actor);
      if (id === 'republish_after_change') await (await import('./republish')).cancelPendingRepublishes(actor);
    } catch (e) {
      console.error(`[foodhub] autopilot clean-up after "${id}" off failed`, e instanceof Error ? e.message : e);
    }
  }
  return state;
}
