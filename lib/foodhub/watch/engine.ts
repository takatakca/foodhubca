// Watchtower engine: detect → open / update / resolve incidents → escalate.
// Runs on every sync (cron or dashboard), and at most every 20 s from the live pulse that every open
// screen polls — so it keeps watching as long as one screen is open or the cron runs.
import crypto from 'node:crypto';
import { logActivity, type Actor } from '../activity';
import { getAdapter } from '../adapters';
import { isRelayStore } from '../adapters/relay';
import { CHANNEL_LABELS, publicBaseUrl } from '../config';
import { lastOrderTimes } from '../order-retry';
import { getCatalog } from '../catalog';
import { deadlineFor } from '../deadline';
import { effectiveHours, getHours, holidaysFor, isOpenAt, localDate, openIntervals } from '../hours';
import { DEVICE_OFFLINE_AFTER_MS, listDevices } from '../identity/devices';
import { aiConfigured, maskContact, normalizePhone, placeCall, postToChat, sendSms } from '../notify';
import { listCases, RECOVERABLE } from '../recon/engine';
import { getRepo } from '../repo';
import { isWaitingScheduled } from '../scheduling';
import { foodhubTimeZone, localParts } from '../time';
import type { ChannelKey, ChannelStore, FoodHubUser, HoursConfig, PlatformStatus, StoredOrder } from '../types';
import { explainIncident, PLAYBOOK } from './ai';
import { customerContact, lateMessage } from './customer';
import { DEFAULT_RULES, DEFAULT_WATCH, INCIDENT_KINDS, KIND_LABEL, type Incident, type IncidentKind, type IncidentStatus, type Severity, type WatchSettings } from './types';

export const INCIDENTS = 'incidents';
const SETTINGS_KEY = 'watch:settings';
const LAST_KEY = 'watch:last';
const SEV: Record<Severity, number> = { info: 0, warning: 1, critical: 2 };
const OPEN_ORDER: StoredOrder['status'][] = ['new', 'accepted', 'ready', 'dispatched'];

// ---------- settings ----------

export async function getWatchSettings(): Promise<WatchSettings> {
  const stored = (await getRepo().getKv<Partial<WatchSettings>>(SETTINGS_KEY).catch(() => null)) ?? {};
  const rules = { ...DEFAULT_RULES };
  for (const k of INCIDENT_KINDS) if (stored.rules?.[k]) rules[k] = { ...DEFAULT_RULES[k], ...stored.rules[k] };
  return { ...DEFAULT_WATCH, ...stored, rules, supportPhones: Array.isArray(stored.supportPhones) ? stored.supportPhones : [] };
}

const clampN = (v: unknown, lo: number, hi: number, def: number) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : def; };
const hhmm = (v: unknown, def: string) => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : def);

export async function saveWatchSettings(patch: Partial<WatchSettings>, actor: Actor): Promise<WatchSettings> {
  const cur = await getWatchSettings();
  const rules = { ...cur.rules };
  for (const k of INCIDENT_KINDS) {
    const r = patch.rules?.[k];
    if (r) rules[k] = { enabled: r.enabled !== false, escalate: r.escalate !== false };
  }
  const next: WatchSettings = {
    ...cur,
    enabled: patch.enabled ?? cur.enabled,
    smsAfterMin: clampN(patch.smsAfterMin, 0, 120, cur.smsAfterMin),
    callAfterMin: clampN(patch.callAfterMin, 1, 240, cur.callAfterMin),
    ownerAfterMin: clampN(patch.ownerAfterMin, 1, 480, cur.ownerAfterMin),
    unacceptedAfterSec: clampN(patch.unacceptedAfterSec, 20, 600, cur.unacceptedAfterSec),
    unseenAfterSec: clampN(patch.unseenAfterSec, 30, 1800, cur.unseenAfterSec),
    lateAfterMin: clampN(patch.lateAfterMin, 1, 60, cur.lateAfterMin),
    courierWaitMin: clampN(patch.courierWaitMin, 1, 30, cur.courierWaitMin),
    silenceAfterMin: clampN(patch.silenceAfterMin, 30, 1440, cur.silenceAfterMin),
    quietFrom: hhmm(patch.quietFrom, cur.quietFrom),
    quietTo: hhmm(patch.quietTo, cur.quietTo),
    postToChat: patch.postToChat ?? cur.postToChat,
    aiExplain: patch.aiExplain ?? cur.aiExplain,
    autoTextLateCustomers: patch.autoTextLateCustomers ?? cur.autoTextLateCustomers,
    supportPhones: Array.isArray(patch.supportPhones) ? patch.supportPhones.map((p) => normalizePhone(p)).filter((p): p is string => Boolean(p)).slice(0, 5) : cur.supportPhones,
    rules,
    updatedAt: new Date().toISOString(),
    updatedBy: actor.name,
  };
  if (next.callAfterMin < next.smsAfterMin) next.callAfterMin = next.smsAfterMin;
  if (next.ownerAfterMin < next.callAfterMin) next.ownerAfterMin = next.callAfterMin;
  await getRepo().setKv(SETTINGS_KEY, next);
  await logActivity({ actor: actor.name, source: actor.source, kind: 'settings', action: 'watch_settings', status: 'success', summary: `Watchtower rules saved (SMS after ${next.smsAfterMin} min, call after ${next.callAfterMin} min, owner after ${next.ownerAfterMin} min)` });
  return next;
}

// ---------- incidents store ----------

export async function listIncidents(filter: { status?: IncidentStatus[]; since?: string; limit?: number; locationCodes?: string[] } = {}): Promise<Incident[]> {
  let list = (await getRepo().listDocs<Incident>(INCIDENTS, { since: filter.since, limit: filter.limit ?? 500 })).map((d) => d.data);
  if (filter.status?.length) list = list.filter((i) => filter.status!.includes(i.status));
  if (filter.locationCodes?.length) list = list.filter((i) => !i.locationCode || filter.locationCodes!.includes(i.locationCode));
  return list.sort((a, b) => SEV[b.severity] - SEV[a.severity] || b.openedAt.localeCompare(a.openedAt));
}

export async function getIncident(id: string): Promise<Incident | null> {
  return (await getRepo().getDoc<Incident>(INCIDENTS, id))?.data ?? null;
}

async function saveIncident(i: Incident) {
  await getRepo().putDocs<Incident>(INCIDENTS, [{ id: i.id, key: i.key, at: i.openedAt, data: i }]);
  return i;
}

// ---------- detection ----------

interface Detection {
  key: string; kind: IncidentKind; severity: Severity;
  title: string; titleEn: string; detail?: string; detailEn?: string;
  locationCode?: string | null; brandName?: string | null; channel?: string | null; orderId?: string | null; storeId?: string | null; deviceId?: string | null;
  customer?: Incident['customer'];
}

function minutesSince(iso: string | null | undefined, now: number) { return iso ? (now - Date.parse(iso)) / 60000 : 0; }
const ord = (o: StoredOrder) => `${CHANNEL_LABELS[o.channel]} #${o.displayId || o.externalOrderId.slice(0, 8)}`;

/** Is any brand open at this location right now (store hours + holidays)? No hours set → 10:00–23:00. */
function locationOpen(hours: HoursConfig, loc: string, brands: string[], now: number, tz: string): boolean {
  const holidays = holidaysFor(hours, loc, localDate(now, tz), 1);
  const fallback = () => { const h = localParts(now, tz).hour; return h >= 10 && h < 23; };
  return (brands.length ? brands : ['__none__']).some((b) => {
    const week = effectiveHours(hours, b, loc);
    return week ? isOpenAt(week, holidays, now, tz) : fallback();
  });
}

function inQuietHours(s: WatchSettings, now: number, tz: string): boolean {
  const p = localParts(now, tz);
  const m = p.hour * 60 + p.minute;
  const [fh, fm] = s.quietFrom.split(':').map(Number); const [th, tm] = s.quietTo.split(':').map(Number);
  const from = fh * 60 + fm; const to = th * 60 + tm;
  return from === to ? false : from < to ? m >= from && m < to : m >= from || m < to;
}

/** Platforms whose silence means something. Too Good To Go sells a few surplus bags at set times: quiet hours are normal there. */
const SILENCE_CHANNELS: ChannelKey[] = ['uber_eats', 'doordash', 'skip'];

/** Taking orders on its platform as far as we know: not paused here, not paused / closed / deactivated / unprovisioned there. */
function takingOrders(st: ChannelStore): boolean {
  const ps = st.meta?.platformStatus as PlatformStatus | undefined;
  return st.online !== false && (st.meta as Record<string, unknown>)?.provisioned !== false && !(ps && ['paused', 'closed', 'deactivated'].includes(ps.state));
}

/** Minutes covered by a set of [from, to] spans (overlaps between stores counted once). */
function coveredMinutes(spans: Array<[number, number]>): number {
  let total = 0; let end = -Infinity;
  for (const [a, b] of [...spans].sort((x, y) => x[0] - y[0])) {
    if (b <= end) continue;
    total += b - Math.max(a, end); end = b;
  }
  return total / 60000;
}

async function detect(s: WatchSettings, now: number): Promise<Detection[]> {
  const repo = getRepo();
  const tz = foodhubTimeZone();
  const [catalog, hours, orders, stores, devices, jobs, sync] = await Promise.all([
    getCatalog(), getHours(), repo.listOrders({ since: new Date(now - 24 * 3600_000).toISOString(), limit: 3000 }),
    repo.listStores(), listDevices(), repo.listJobs(200), repo.getKv<{ at: string }>('sync:last').catch(() => null),
  ]);
  const loc = (code?: string | null) => (code ? catalog.locations.find((l) => l.code === code)?.name ?? code : 'magasin non relié');
  const brandsAt = (code: string) => [...new Set(stores.filter((x) => x.locationCode === code).map((x) => x.brandName))];
  const out: Detection[] = [];
  const on = (k: IncidentKind) => s.rules[k]?.enabled !== false;
  const mappedStores = new Set(stores.map((x) => `${x.channel}|${x.channelStoreId}`));
  /** Held for a person because nobody mapped its platform store (store_unmapped below covers it, deadline included). */
  const heldUnmapped = (o: StoredOrder) => on('store_unmapped') && o.status === 'new' && !o.viaPos && !o.locationCode && !mappedStores.has(`${o.channel}|${o.channelStoreId}`);

  for (const o of orders) {
    const age = (now - Date.parse(o.createdAt)) / 1000;
    const where = `${o.brandName ?? 'Marque ?'} · ${loc(o.locationCode)}`;
    const base = { locationCode: o.locationCode ?? null, brandName: o.brandName ?? null, channel: o.channel, orderId: o.id };
    if (on('order_unaccepted') && o.status === 'new' && !heldUnmapped(o) && !isWaitingScheduled(o, now) && age >= s.unacceptedAfterSec) {
      const deadline = deadlineFor(o);
      const left = deadline ? (Date.parse(deadline) - now) / 1000 : null;
      const critical = (left !== null && left < 150) || age > 180;
      out.push({ ...base, key: `order_unaccepted:${o.id}`, kind: 'order_unaccepted', severity: critical ? 'critical' : 'warning',
        title: `${ord(o)} attend depuis ${Math.round(age / 60) || 1} min`, titleEn: `${ord(o)} waiting for ${Math.round(age / 60) || 1} min`,
        detail: `${where}${left !== null ? (left > 0 ? ` · ${Math.ceil(left / 60)} min avant l’échéance` : ' · échéance dépassée') : ''}`,
        detailEn: `${where}${left !== null ? (left > 0 ? ` · ${Math.ceil(left / 60)} min to the deadline` : ' · deadline passed') : ''}` });
    }
    if (on('order_unseen') && o.status === 'accepted' && !o.timeline?.seenAt && !isWaitingScheduled(o, now) && age >= s.unseenAfterSec && age < 3 * 3600) {
      out.push({ ...base, key: `order_unseen:${o.id}`, kind: 'order_unseen', severity: age > 300 ? 'critical' : 'warning',
        title: `${ord(o)} pas vue en cuisine`, titleEn: `${ord(o)} not seen in the kitchen`, detail: `${where} · acceptée automatiquement il y a ${Math.round(age / 60)} min`, detailEn: `${where} · auto-accepted ${Math.round(age / 60)} min ago` });
    }
    const target = o.timeline?.readyTarget;
    if (on('order_late') && o.status === 'accepted' && target && !isWaitingScheduled(o, now)) {
      const late = minutesSince(target, now);
      if (late >= s.lateAfterMin) {
        const c = customerContact(o);
        const msg = lateMessage(o, 10);
        out.push({ ...base, key: `order_late:${o.id}`, kind: 'order_late', severity: late >= 15 ? 'critical' : 'warning',
          title: `${ord(o)} en retard de ${Math.round(late)} min`, titleEn: `${ord(o)} ${Math.round(late)} min late`, detail: where, detailEn: where,
          customer: { name: c.name, phone: c.phone, draftFr: msg.fr, draftEn: msg.en } });
      }
    }
    const courier = o.timeline?.courier;
    if (on('courier_waiting') && courier?.status === 'at_store' && o.status === 'accepted') {
      const wait = minutesSince(courier.updatedAt, now);
      if (wait >= s.courierWaitMin) {
        out.push({ ...base, key: `courier_waiting:${o.id}`, kind: 'courier_waiting', severity: wait >= 8 ? 'critical' : 'warning',
          title: `Le livreur attend ${ord(o)} depuis ${Math.round(wait)} min`, titleEn: `Courier waiting ${Math.round(wait)} min for ${ord(o)}`, detail: `${where}${courier.name ? ` · ${courier.name}` : ''}`, detailEn: `${where}${courier.name ? ` · ${courier.name}` : ''}` });
      }
    }
    if (on('pos_failed') && o.posError && !o.posOrderId && OPEN_ORDER.includes(o.status)) {
      // While Food Hub is still retrying Clover by itself (30 s, 2 min) the incident shows on screen only (info never
      // escalates); once the retries are used up it turns critical and the escalation starts at once.
      const retrying = Boolean(o.timeline?.posRetry?.nextAt) && !o.timeline?.posRetry?.gaveUpAt;
      out.push({ ...base, key: `pos_failed:${o.id}`, kind: 'pos_failed', severity: retrying ? 'info' : 'critical',
        title: retrying ? `Clover n’a pas encore reçu ${ord(o)} — nouvel essai automatique` : `Clover n’a pas reçu ${ord(o)}`,
        titleEn: retrying ? `Clover has not got ${ord(o)} yet — retrying automatically` : `Clover did not get ${ord(o)}`,
        detail: `${where} · ${o.posError}`, detailEn: `${where} · ${o.posError}` });
    }
    if (on('customer_issue') && age < 2 * 3600 && o.status === 'cancelled' && o.timeline?.cancelledBy && o.timeline.cancelledBy !== 'store') {
      const who = o.timeline.cancelledBy === 'customer' ? ['le client', 'the customer'] : ['la plateforme', 'the platform'];
      out.push({ ...base, key: `customer_issue:${o.id}`, kind: 'customer_issue', severity: 'info', title: `${ord(o)} annulée par ${who[0]}`, titleEn: `${ord(o)} cancelled by ${who[1]}`, detail: `${where}${o.timeline.cancelReason ? ` · ${o.timeline.cancelReason}` : ''}`, detailEn: `${where}${o.timeline.cancelReason ? ` · ${o.timeline.cancelReason}` : ''}` });
    }
  }

  if (on('cancel_spike')) {
    const byLoc = new Map<string, number>();
    for (const o of orders) if (o.status === 'cancelled' && o.locationCode && now - Date.parse(o.timeline?.cancelledAt ?? o.updatedAt) < 3600_000) byLoc.set(o.locationCode, (byLoc.get(o.locationCode) ?? 0) + 1);
    for (const [code, n] of byLoc) if (n >= 3) out.push({ key: `cancel_spike:${code}`, kind: 'cancel_spike', severity: 'warning', locationCode: code, title: `${n} annulations en 1 h à ${loc(code)}`, titleEn: `${n} cancellations in 1 h at ${loc(code)}` });
  }

  // Orders from a platform store nobody mapped: the pipeline does not accept them by itself (wrong brand or kitchen
  // possible) and may have kept them out of Clover. One incident per platform store, naming its id; it closes when
  // every such order is accepted / rejected / cancelled, or when the store gets mapped. Orders that came through
  // Clover's own integration are only followed (never "new"), so they never count.
  if (on('store_unmapped')) {
    const held = new Map<string, StoredOrder[]>();
    for (const o of orders) {
      if (!heldUnmapped(o)) continue;
      const k = `${o.channel}:${o.channelStoreId ?? ''}`;
      held.set(k, [...(held.get(k) ?? []), o]);
    }
    for (const [k, list] of held) {
      list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const first = list[0];
      const label = CHANNEL_LABELS[first.channel];
      const sid = first.channelStoreId || '';
      // Suggested mapping: the brand the order names and, when that brand runs from one kitchen only, that kitchen.
      // A suggestion for a person to confirm — nothing is mapped automatically.
      const named = list.map((o) => o.brandName?.trim()).find(Boolean);
      const brand = named ? catalog.brands.find((b) => b.name.toLowerCase() === named.toLowerCase())?.name ?? named : null;
      const kitchens = brand ? [...new Set(stores.filter((x) => x.brandName === brand).map((x) => x.locationCode))] : [];
      const hint = kitchens.length === 1 ? kitchens[0] : null;
      const ids = list.slice(0, 3).map((o) => `#${o.displayId || o.externalOrderId.slice(0, 8)}`).join(', ') + (list.length > 3 ? '…' : '');
      const deadline = deadlineFor(first);
      const left = deadline ? Math.ceil((Date.parse(deadline) - now) / 60000) : null;
      const due = left === null ? ['', ''] : left > 0 ? [` · ${left} min avant l’échéance`, ` · ${left} min to the deadline`] : [' · échéance dépassée', ' · deadline passed'];
      out.push({ key: `store_unmapped:${k}`, kind: 'store_unmapped', severity: 'critical', channel: first.channel, orderId: first.id, brandName: brand, locationCode: null,
        title: `Commande d’un magasin ${label} non relié : ${sid || '(sans identifiant)'}`, titleEn: `Order from an unmapped ${label} store: ${sid || '(no id)'}`,
        detail: `${list.length} commande(s) en attente (${ids}), non acceptée(s) automatiquement${due[0]}${brand ? ` · marque indiquée : ${brand}` : ''}${hint ? ` · à relier à ${brand} · ${loc(hint)} ?` : ''}`,
        detailEn: `${list.length} order(s) waiting (${ids}), not accepted automatically${due[1]}${brand ? ` · brand on the order: ${brand}` : ''}${hint ? ` · link it to ${brand} · ${loc(hint)}?` : ''}` });
    }
  }

  for (const st of stores) {
    const ps = st.meta?.platformStatus as PlatformStatus | undefined;
    const name = `${st.brandName} · ${loc(st.locationCode)} · ${CHANNEL_LABELS[st.channel]}`;
    const base = { locationCode: st.locationCode, brandName: st.brandName, channel: st.channel, storeId: st.id };
    if (on('store_deactivated') && (ps?.state === 'deactivated' || (st.meta as Record<string, unknown>)?.provisioned === false)) {
      out.push({ ...base, key: `store_deactivated:${st.id}`, kind: 'store_deactivated', severity: 'critical', title: `${name} désactivé`, titleEn: `${name} deactivated`, detail: ps?.detail ?? undefined, detailEn: ps?.detail ?? undefined });
      continue;
    }
    if (on('store_offline') && ps && ps.source !== 'dashboard' && (ps.state === 'paused' || ps.state === 'closed')) {
      const week = effectiveHours(hours, st.brandName, st.locationCode);
      const shouldBeOpen = week ? isOpenAt(week, holidaysFor(hours, st.locationCode, localDate(now, tz), 1), now, tz) : ps.state === 'paused';
      if (shouldBeOpen) out.push({ ...base, key: `store_offline:${st.id}`, kind: 'store_offline', severity: 'warning', title: `${name} hors ligne (plateforme)`, titleEn: `${name} offline (platform)`, detail: ps.detail ?? undefined, detailEn: ps.detail ?? undefined });
    }
  }

  for (const d of devices.filter((x) => !x.revoked)) {
    const open = locationOpen(hours, d.locationCode, brandsAt(d.locationCode), now, tz);
    if (!open) continue;
    const seenAgo = d.lastSeenAt ? now - Date.parse(d.lastSeenAt) : Infinity;
    const base = { locationCode: d.locationCode, deviceId: d.id };
    if (on('device_offline') && seenAgo > DEVICE_OFFLINE_AFTER_MS) {
      const min = Number.isFinite(seenAgo) ? Math.round(seenAgo / 60000) : null;
      out.push({ ...base, key: `device_offline:${d.id}`, kind: 'device_offline', severity: seenAgo > 5 * 60_000 ? 'critical' : 'warning',
        title: `Tablette « ${d.name} » éteinte — ${loc(d.locationCode)}`, titleEn: `Tablet “${d.name}” is off — ${loc(d.locationCode)}`,
        detail: min !== null ? `Aucun signal depuis ${min} min${d.battery !== null && d.battery !== undefined ? ` · batterie ${Math.round(d.battery * 100)} %` : ''}` : 'Jamais connectée', detailEn: min !== null ? `No signal for ${min} min` : 'Never connected' });
    } else if (on('device_muted') && seenAgo <= DEVICE_OFFLINE_AFTER_MS && (d.soundOn === false || d.visible === false)) {
      out.push({ ...base, key: `device_muted:${d.id}`, kind: 'device_muted', severity: 'warning',
        title: `Tablette « ${d.name} » ${d.soundOn === false ? 'sans son' : 'écran caché'} — ${loc(d.locationCode)}`, titleEn: `Tablet “${d.name}” ${d.soundOn === false ? 'muted' : 'screen hidden'} — ${loc(d.locationCode)}` });
    }
  }

  // Silence alarm: a platform that used to send orders has sent none for `silenceAfterMin` of OPENING time — a closed
  // night never counts — over its stores that are taking orders (relay-only stores are not the platform's own link),
  // while one of them is open right now: a webhook or a key is probably broken. Stores without known hours never count.
  // Too Good To Go is left out: a few surplus bags at set times make quiet hours normal there.
  if (on('platform_silent')) {
    const last = await lastOrderTimes();
    for (const ch of SILENCE_CHANNELS) {
      const lastMs = Date.parse(last[ch] ?? '');
      if (!Number.isFinite(lastMs) || now - lastMs < s.silenceAfterMin * 60_000) continue;
      const adapter = getAdapter(ch).readiness();
      if (!adapter.configured && !adapter.viaClover) continue;
      const since = Math.max(lastMs, now - 7 * 86400_000); // a week of opening hours is plenty to count
      const live = stores.flatMap((st) => {
        const week = st.channel === ch && !isRelayStore(st) && takingOrders(st) ? effectiveHours(hours, st.brandName, st.locationCode) : null;
        return week ? [{ week, off: holidaysFor(hours, st.locationCode, localDate(since, tz), 8) }] : [];
      });
      const openNow = live.filter((x) => isOpenAt(x.week, x.off, now, tz));
      if (!openNow.length) continue;
      const openMin = coveredMinutes(live.flatMap((x) => openIntervals(x.week, x.off, since, now, tz)));
      if (openMin < s.silenceAfterMin) continue;
      const hoursQuiet = Math.floor((now - lastMs) / 3600_000);
      const openHm = `${Math.floor(openMin / 60)} h ${String(Math.floor(openMin % 60)).padStart(2, '0')}`;
      const label = CHANNEL_LABELS[ch];
      out.push({ key: `platform_silent:${ch}`, kind: 'platform_silent', severity: 'warning', channel: ch,
        title: `Aucune commande ${label} depuis ${hoursQuiet || 1} h — ${openNow.length} magasin(s) ouvert(s)`, titleEn: `No ${label} order for ${hoursQuiet || 1} h — ${openNow.length} store(s) open`,
        detail: `${openHm} d’ouverture sans commande. Dernière commande : ${localDate(lastMs, tz)} ${new Date(lastMs).toLocaleTimeString('fr-CA', { timeZone: tz, hour: '2-digit', minute: '2-digit' })}. Vérifiez la tablette ${label} et la boîte de réception des webhooks.`,
        detailEn: `${openHm} of opening hours without an order. Last order: ${new Date(lastMs).toLocaleString('en-CA', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' })}. Check the ${label} tablet and the webhook inbox.` });
    }
  }

  const polled = stores.filter((x) => x.channel === 'uber_eats' || x.channel === 'doordash').length;
  if (on('sync_stale') && polled && (!sync || now - Date.parse(sync.at) > 15 * 60_000)) {
    out.push({ key: 'sync_stale', kind: 'sync_stale', severity: 'warning', title: 'Statuts des magasins pas à jour depuis 15+ min', titleEn: 'Store statuses not refreshed for 15+ min' });
  }
  const hourAgo = new Date(now - 3600_000).toISOString();
  const unparsed = jobs.filter((j) => j.kind === 'webhook_unparsed' && j.createdAt >= hourAgo).length;
  if (on('webhook_unreadable') && unparsed) out.push({ key: 'webhook_unreadable', kind: 'webhook_unreadable', severity: 'warning', title: `${unparsed} message(s) de plateforme illisible(s)`, titleEn: `${unparsed} unreadable platform message(s)` });
  // 'blocked' = never sent (no API for that platform, live switch off, a locked store…): honest, but nothing was refused.
  const failed = jobs.filter((j) => j.status === 'error' && j.kind !== 'webhook_unparsed' && (j.result as { status?: string } | null)?.status !== 'blocked' && j.createdAt >= new Date(now - 2 * 3600_000).toISOString());
  if (on('menu_failed') && failed.length) {
    const what = [...new Set(failed.map((j) => `${CHANNEL_LABELS[j.channel as keyof typeof CHANNEL_LABELS] ?? j.channel} ${j.kind.replace(/_/g, ' ')}`))].join(', ');
    out.push({ key: 'menu_failed', kind: 'menu_failed', severity: 'warning', title: `${failed.length} action(s) refusée(s) par une plateforme`, titleEn: `${failed.length} action(s) refused by a platform`, detail: what, detailEn: what });
  }
  if (on('payout_gap')) {
    const cases = (await listCases({ status: ['open'] }).catch(() => [])).filter((c) => RECOVERABLE.includes(c.type));
    const owed = Math.round(cases.reduce((a, c) => a + c.amount, 0) * 100) / 100;
    if (owed >= 1) out.push({ key: 'payout_gap', kind: 'payout_gap', severity: 'info', title: `${owed.toFixed(2).replace('.', ',')} $ à récupérer des plateformes`, titleEn: `$${owed.toFixed(2)} to recover from the platforms`, detail: `${cases.length} cas à contester`, detailEn: `${cases.length} case(s) to dispute` });
  }
  return out;
}

// ---------- escalation ----------

function recipients(users: FoodHubUser[], i: Incident, roles: Array<FoodHubUser['role']>, kind: 'sms' | 'call') {
  return users.filter((u) => u.active && u.phone && roles.includes(u.role)
    && (!i.locationCode || !u.locations?.length || u.locations.includes(i.locationCode))
    && u.prefs?.onDuty !== false
    && (kind === 'sms' ? u.prefs?.alertSms !== false : u.prefs?.alertCall !== false));
}

function smsText(i: Incident, lang: 'fr' | 'en') {
  const url = `${publicBaseUrl()}/alerts?i=${i.id}`;
  return lang === 'fr'
    ? `TAKATAK ${i.severity === 'critical' ? '🔴' : '🟠'} ${i.title}${i.detail ? ` — ${i.detail}` : ''}\n${PLAYBOOK[i.kind].doFr[0] ?? ''}\n${url}`
    : `TAKATAK ${i.severity === 'critical' ? '🔴' : '🟠'} ${i.titleEn}${i.detailEn ? ` — ${i.detailEn}` : ''}\n${PLAYBOOK[i.kind].doEn[0] ?? ''}\n${url}`;
}

function callText(i: Incident, lang: 'fr' | 'en') {
  return lang === 'fr'
    ? `Alerte TAKATAK. ${i.title}. ${PLAYBOOK[i.kind].doFr[0] ?? ''}. Ouvrez l'application TAKATAK pour confirmer.`
    : `TAKATAK alert. ${i.titleEn}. ${PLAYBOOK[i.kind].doEn[0] ?? ''}. Open the TAKATAK app to confirm.`;
}

/** Incidents the kitchen itself can fix: the kitchen phone rings first (like Uber calling the restaurant). */
const KITCHEN_KINDS: IncidentKind[] = ['order_unaccepted', 'order_unseen', 'device_offline', 'device_muted', 'courier_waiting', 'pos_failed'];

async function escalate(i: Incident, s: WatchSettings, users: FoodHubUser[], now: number, quiet: boolean, kitchenPhones: Map<string, string> = new Map()): Promise<boolean> {
  if (i.status !== 'open') return false;
  const rule = s.rules[i.kind] ?? { enabled: true, escalate: false };
  if (!rule.escalate || i.severity === 'info') return false;
  if (quiet && i.severity !== 'critical') return false;
  const elapsed = (now - Date.parse(i.openedAt)) / 60000;
  let changed = false;
  const step = (kind: Incident['steps'][number]['kind'], to: string, ok: boolean, message: string) => { i.steps.push({ at: new Date(now).toISOString(), kind, to, ok, message }); changed = true; };

  if (i.level < 1 && elapsed >= s.smsAfterMin) {
    i.level = 1; changed = true;
    const kitchen = i.locationCode ? kitchenPhones.get(i.locationCode) : undefined;
    if (kitchen && KITCHEN_KINDS.includes(i.kind)) {
      const r = await placeCall({ to: kitchen, say: callText(i, 'fr'), lang: 'fr' }, { purpose: 'alert_kitchen', incidentId: i.id });
      step('call', `${i.locationCode} (${maskContact(kitchen)})`, r.ok, r.message);
    }
    const to = recipients(users, i, ['manager'], 'sms');
    const list = to.length ? to : recipients(users, i, ['owner'], 'sms');
    for (const u of list) {
      const r = await sendSms({ to: u.phone!, body: smsText(i, u.prefs?.lang ?? 'fr') }, { purpose: 'alert', incidentId: i.id });
      step('sms', `${u.name} (${maskContact(u.phone!)})`, r.ok, r.message);
    }
    if (i.severity === 'critical') {
      for (const p of s.supportPhones) {
        const r = await sendSms({ to: p, body: smsText(i, 'fr') }, { purpose: 'alert_support', incidentId: i.id });
        step('sms', `support (${maskContact(p)})`, r.ok, r.message);
      }
    }
    if (!list.length) step('sms', '—', false, 'Aucun gérant de garde avec un cellulaire. / No manager on duty with a phone.');
  }
  if (i.level < 2 && elapsed >= s.callAfterMin && i.severity === 'critical') {
    i.level = 2; changed = true;
    const to = recipients(users, i, ['manager'], 'call');
    for (const u of (to.length ? to : recipients(users, i, ['owner'], 'call')).slice(0, 2)) {
      const r = await placeCall({ to: u.phone!, say: callText(i, u.prefs?.lang ?? 'fr'), lang: u.prefs?.lang ?? 'fr' }, { purpose: 'alert', incidentId: i.id });
      step('call', `${u.name} (${maskContact(u.phone!)})`, r.ok, r.message);
    }
  }
  if (i.level < 3 && elapsed >= s.ownerAfterMin && i.severity === 'critical') {
    i.level = 3; changed = true;
    for (const u of recipients(users, i, ['owner'], 'sms')) {
      const r = await sendSms({ to: u.phone!, body: `${smsText(i, u.prefs?.lang ?? 'fr')}\n(${Math.round(elapsed)} min sans réponse / no answer)` }, { purpose: 'alert_owner', incidentId: i.id });
      step('owner', `${u.name} (${maskContact(u.phone!)})`, r.ok, r.message);
      if (u.prefs?.alertCall !== false) {
        const c = await placeCall({ to: u.phone!, say: callText(i, u.prefs?.lang ?? 'fr'), lang: u.prefs?.lang ?? 'fr' }, { purpose: 'alert_owner', incidentId: i.id });
        step('call', `${u.name} (${maskContact(u.phone!)})`, c.ok, c.message);
      }
    }
    for (const p of s.supportPhones) {
      const c = await placeCall({ to: p, say: callText(i, 'fr'), lang: 'fr' }, { purpose: 'alert_support', incidentId: i.id });
      step('call', `support (${maskContact(p)})`, c.ok, c.message);
    }
  }
  return changed;
}

// ---------- the run ----------

export interface WatchReport { at: string; trigger: string; ran: boolean; detections: number; opened: number; updated: number; resolved: number; escalated: number; open: number }

export async function runWatch(opts: { trigger?: string; force?: boolean; now?: number } = {}): Promise<WatchReport> {
  const now = opts.now ?? Date.now();
  const repo = getRepo();
  const empty = (ran: boolean): WatchReport => ({ at: new Date(now).toISOString(), trigger: opts.trigger ?? 'manual', ran, detections: 0, opened: 0, updated: 0, resolved: 0, escalated: 0, open: 0 });
  const s = await getWatchSettings();
  if (!s.enabled) return empty(false);
  const last = await repo.getKv<{ at: string }>(LAST_KEY).catch(() => null);
  if (!opts.force && last && now - Date.parse(last.at) < 20_000) return empty(false);
  const g = globalThis as unknown as { __takatakWatchRunning?: number };
  if (g.__takatakWatchRunning && now - g.__takatakWatchRunning < 60_000) return empty(false);
  g.__takatakWatchRunning = now;
  try {
    await repo.setKv(LAST_KEY, { at: new Date(now).toISOString() });
    const report = empty(true);
    const detections = await detect(s, now);
    report.detections = detections.length;
    const all = (await repo.listDocs<Incident>(INCIDENTS, { since: new Date(now - 3 * 86400_000).toISOString(), limit: 2000 })).map((d) => d.data);
    const live = new Map(all.filter((i) => i.status !== 'resolved').map((i) => [i.key, i]));
    const recentlyResolved = new Map(all.filter((i) => i.status === 'resolved' && i.resolvedAt && now - Date.parse(i.resolvedAt) < 10 * 60_000 && i.resolvedBy === 'auto').map((i) => [i.key, i]));
    const seen = new Set<string>();
    const iso = new Date(now).toISOString();
    const fresh: Incident[] = [];
    const dirty = new Map<string, Incident>();

    for (const d of detections) {
      seen.add(d.key);
      const cur = live.get(d.key) ?? recentlyResolved.get(d.key);
      if (cur) {
        const up = SEV[d.severity] > SEV[cur.severity];
        const reopened = cur.status === 'resolved';
        const unsnoozed = cur.status === 'snoozed' && cur.snoozedUntil && Date.parse(cur.snoozedUntil) <= now;
        // orderId follows the detection: store_unmapped points at its oldest waiting order, which changes as they are handled.
        Object.assign(cur, { title: d.title, titleEn: d.titleEn, detail: d.detail ?? cur.detail, detailEn: d.detailEn ?? cur.detailEn, orderId: d.orderId ?? cur.orderId, lastSeenAt: iso, updatedAt: iso, customer: d.customer ?? cur.customer });
        if (up) { cur.severity = d.severity; cur.count += 1; if (cur.status === 'acknowledged') { cur.status = 'open'; cur.steps.push({ at: iso, kind: 'reopened', message: 'Plus grave — réouvert / Got worse — reopened' }); } }
        if (reopened) { cur.status = 'open'; cur.resolvedAt = null; cur.resolvedBy = null; cur.steps.push({ at: iso, kind: 'reopened', message: 'Le problème est revenu / Problem came back' }); }
        if (unsnoozed) { cur.status = 'open'; cur.snoozedUntil = null; cur.steps.push({ at: iso, kind: 'reopened', message: 'Fin de la sourdine / Snooze ended' }); }
        dirty.set(cur.id, cur);
        report.updated++;
      } else {
        const p = PLAYBOOK[d.kind];
        const i: Incident = {
          id: crypto.randomUUID(), key: d.key, kind: d.kind, severity: d.severity, status: 'open', title: d.title, titleEn: d.titleEn, detail: d.detail, detailEn: d.detailEn,
          locationCode: d.locationCode ?? null, brandName: d.brandName ?? null, channel: d.channel ?? null, orderId: d.orderId ?? null, storeId: d.storeId ?? null, deviceId: d.deviceId ?? null,
          openedAt: iso, updatedAt: iso, lastSeenAt: iso, level: 0, steps: [{ at: iso, kind: 'opened', message: KIND_LABEL[d.kind].fr }],
          explanation: `${p.fr}\n\n${p.en}`, suggestions: p.doFr, customer: d.customer ?? null, count: 1,
        };
        fresh.push(i);
        dirty.set(i.id, i);
        report.opened++;
      }
    }
    // Problems that went away close by themselves.
    for (const i of live.values()) {
      if (seen.has(i.key)) continue;
      Object.assign(i, { status: 'resolved', resolvedAt: iso, resolvedBy: 'auto', updatedAt: iso });
      i.steps.push({ at: iso, kind: 'resolved', by: 'auto', message: 'Réglé / Fixed' });
      dirty.set(i.id, i);
      report.resolved++;
    }

    // New warning / critical incidents → team chat; Claude explains the first few.
    for (const i of fresh) {
      if (i.severity === 'info') continue;
      if (s.postToChat) {
        const r = await postToChat({ title: i.title, text: [i.detail, PLAYBOOK[i.kind].doFr[0]].filter(Boolean).join('\n'), severity: i.severity, link: `${publicBaseUrl()}/alerts?i=${i.id}` }, { purpose: 'alert', incidentId: i.id });
        if (!r.skipped) i.steps.push({ at: iso, kind: 'chat', to: 'team chat', ok: r.ok, message: r.message });
      }
    }
    if (s.aiExplain && aiConfigured()) {
      for (const i of fresh.filter((x) => x.severity !== 'info').slice(0, 2)) {
        const text = await explainIncident(i, { location: i.locationCode, brand: i.brandName, channel: i.channel, playbook: PLAYBOOK[i.kind].fr });
        if (text) { i.explanation = text; i.steps.push({ at: iso, kind: 'ai', message: 'Explication par Claude / Explained by Claude' }); }
      }
    }

    // Late orders: courtesy text when allowed and possible.
    if (s.autoTextLateCustomers) {
      for (const i of dirty.values()) {
        if (i.kind !== 'order_late' || i.status !== 'open' || !i.customer?.phone || i.steps.some((x) => x.kind === 'customer_sms')) continue;
        const order = i.orderId ? await repo.getOrder(i.orderId) : null;
        if (!order || !customerContact(order).canSms) continue;
        const r = await sendSms({ to: i.customer.phone, body: i.customer.draftFr ?? '' }, { purpose: 'customer_late', incidentId: i.id, orderId: i.orderId ?? undefined, by: 'Watchtower' });
        i.steps.push({ at: iso, kind: 'customer_sms', to: maskContact(i.customer.phone), ok: r.ok, message: r.message, by: 'Watchtower' });
      }
    }

    const quiet = inQuietHours(s, now, foodhubTimeZone());
    const users = await repo.listUsers();
    const kitchenPhones = new Map((await getCatalog()).locations.filter((l) => l.phone).map((l) => [l.code, l.phone!] as const));
    for (const i of dirty.values()) if (await escalate(i, s, users, now, quiet, kitchenPhones)) report.escalated++;
    // Open incidents not touched this run can still need the next escalation step.
    for (const i of live.values()) if (!dirty.has(i.id) && (await escalate(i, s, users, now, quiet, kitchenPhones))) dirty.set(i.id, i);

    for (const i of dirty.values()) await saveIncident(i);
    for (const i of fresh.filter((x) => x.severity === 'critical')) {
      await logActivity({ actor: 'Watchtower', source: 'automation', kind: 'incident', action: i.kind, status: 'info', locationCode: i.locationCode, brandName: i.brandName, orderId: i.orderId, summary: i.titleEn });
    }
    report.open = [...live.values(), ...fresh].filter((i) => i.status === 'open' || i.status === 'acknowledged').length;
    return report;
  } finally {
    g.__takatakWatchRunning = 0;
  }
}

// ---------- people actions ----------

export async function actOnIncident(id: string, action: 'ack' | 'resolve' | 'snooze' | 'note' | 'reopen', actor: Actor, opts: { minutes?: number; note?: string } = {}): Promise<Incident | null> {
  const i = await getIncident(id);
  if (!i) return null;
  const iso = new Date().toISOString();
  if (action === 'ack') { if (i.status === 'open' || i.status === 'snoozed') Object.assign(i, { status: 'acknowledged', ackBy: actor.name, ackAt: iso }); i.steps.push({ at: iso, kind: 'ack', by: actor.name, message: 'Pris en charge / On it' }); }
  if (action === 'resolve') { Object.assign(i, { status: 'resolved', resolvedAt: iso, resolvedBy: actor.name }); i.steps.push({ at: iso, kind: 'resolved', by: actor.name, message: opts.note || 'Réglé / Fixed' }); }
  if (action === 'snooze') { const m = Math.max(5, Math.min(240, Math.round(opts.minutes ?? 30))); Object.assign(i, { status: 'snoozed', snoozedUntil: new Date(Date.now() + m * 60_000).toISOString() }); i.steps.push({ at: iso, kind: 'snooze', by: actor.name, message: `Sourdine ${m} min / Snoozed ${m} min` }); }
  if (action === 'reopen') { Object.assign(i, { status: 'open', resolvedAt: null, resolvedBy: null, snoozedUntil: null }); i.steps.push({ at: iso, kind: 'reopened', by: actor.name }); }
  if (action === 'note' && opts.note) i.steps.push({ at: iso, kind: 'note', by: actor.name, message: opts.note.slice(0, 500) });
  i.updatedAt = iso;
  await saveIncident(i);
  if (action !== 'note') await logActivity({ actor: actor.name, source: actor.source, kind: 'incident', action: `incident_${action}`, status: 'success', locationCode: i.locationCode, orderId: i.orderId, summary: `${actor.name}: ${action} — ${i.titleEn}` });
  return i;
}

export async function addIncidentStep(id: string, step: Incident['steps'][number]): Promise<void> {
  const i = await getIncident(id);
  if (!i) return;
  i.steps.push(step);
  i.updatedAt = new Date().toISOString();
  await saveIncident(i);
}

export function isOpenStatus(s: IncidentStatus) { return s === 'open' || s === 'acknowledged'; }
