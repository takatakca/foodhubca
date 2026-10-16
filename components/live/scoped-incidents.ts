'use client';

// Alerts of the console's scope: the location goes to the server (`locations=`, kept inside the person's own locations),
// then brand and platform are filtered here, loosely — an alert that names no brand or platform (a tablet offline, a
// sync problem) always shows. The bell, the nav badges and the alarms keep counting every alert of the location.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePulse, useRefreshOn } from './pulse';
import { inScopeLoose } from '@/lib/foodhub/scope';
import { api } from '@/lib/ui/api';
import type { Incident } from '@/lib/foodhub/watch/types';

/**
 * `status`: which statuses to fetch ('' = all, for the Alerts page's "fixed" tab). `days`: how far back. `poll`: also
 * reload every N ms (besides each change of the pulse's alert count and each refresh event).
 */
export function useScopedIncidents({ status = 'open,acknowledged', days = 3, poll }: { status?: string; days?: number; poll?: number } = {}) {
  const { pulse, site } = usePulse();
  const [all, setAll] = useState<Incident[] | null>(null);
  const kitchen = site.kitchen;
  const load = useCallback(async () => {
    const q = new URLSearchParams({ days: String(days) });
    if (status) q.set('status', status);
    if (kitchen) q.set('locations', kitchen);
    const d = await api<{ incidents: Incident[] }>(`/api/foodhub/incidents?${q}`).catch(() => null);
    if (d) setAll(d.incidents);
  }, [status, days, kitchen]);
  const count = pulse ? `${pulse.incidents.open}|${pulse.incidents.critical}` : '';
  useEffect(() => { void load(); }, [load, count]);
  useEffect(() => {
    if (!poll) return;
    const i = setInterval(() => void load(), poll);
    return () => clearInterval(i);
  }, [load, poll]);
  useRefreshOn(load);
  const list = useMemo(() => (all ? all.filter((i) => inScopeLoose(i, site)) : null), [all, site]);
  return {
    /** The alerts of the scope (null while loading). */
    list,
    /** How many alerts the location has before the brand / platform filter. */
    total: all?.length ?? 0,
    /** A brand or a platform narrows the list. */
    filtered: Boolean(site.brand || site.channel),
    reload: load,
  };
}
