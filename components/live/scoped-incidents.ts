'use client';

// Alerts of the console's scope: the location goes to the server (`locations=`, kept inside the person's own locations),
// then brand and platform are filtered here, loosely — an alert that names no brand or platform (a tablet offline, a
// sync problem) always shows. The alert a link points at (`/alerts?i=…`) always shows, whatever the scope. The bell, the
// nav badges and the alarms keep counting every alert of the location.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePulse, useRefreshOn } from './pulse';
import { useViewer } from '@/components/shell/viewer';
import { scopedAlerts } from '@/lib/foodhub/scope';
import { api } from '@/lib/ui/api';
import type { Incident } from '@/lib/foodhub/watch/types';

/**
 * `status`: which statuses to fetch ('' = all, for the Alerts page's "fixed" tab). `days`: how far back. `poll`: also
 * reload every N ms (besides each change of the pulse's alert count and each refresh event).
 */
export function useScopedIncidents({ status = 'open,acknowledged', days = 3, poll, focusId }: { status?: string; days?: number; poll?: number; focusId?: string | null } = {}) {
  const { pulse, site } = usePulse();
  const { viewer } = useViewer();
  const [all, setAll] = useState<Incident[] | null>(null);
  const [focused, setFocused] = useState<Incident | null>(null);
  const kitchen = site.kitchen;
  const load = useCallback(async () => {
    const q = new URLSearchParams({ days: String(days) });
    if (status) q.set('status', status);
    if (kitchen) q.set('locations', kitchen);
    // The alert a text or chat link points at (`?i=`) is fetched on its own, without the scope: it shows even when this
    // device remembers another location (the server still keeps it inside the person's own locations).
    const [d, one] = await Promise.all([
      api<{ incidents: Incident[] }>(`/api/foodhub/incidents?${q}`).catch(() => null),
      focusId ? api<{ incidents: Incident[] }>(`/api/foodhub/incidents?${new URLSearchParams({ days: '30', id: focusId })}`).catch(() => null) : null,
    ]);
    if (d) setAll(d.incidents);
    setFocused(one?.incidents[0] ?? null);
  }, [status, days, kitchen, focusId]);
  const count = pulse ? `${pulse.incidents.open}|${pulse.incidents.critical}` : '';
  useEffect(() => { void load(); }, [load, count]);
  useEffect(() => {
    if (!poll) return;
    const i = setInterval(() => void load(), poll);
    return () => clearInterval(i);
  }, [load, poll]);
  useRefreshOn(load);
  const list = useMemo(() => (all ? scopedAlerts(all, site, focused) : null), [all, site, focused]);
  return {
    /** The alerts of the scope (null while loading), the linked one (`focusId`) first whatever the scope. */
    list,
    /** How many alerts the location has before the brand / platform filter. */
    total: all?.length ?? 0,
    /** A location (not on a kitchen tablet, which never leaves its own), a brand or a platform narrows the list. */
    filtered: Boolean((site.kitchen && !viewer.device) || site.brand || site.channel),
    reload: load,
  };
}
