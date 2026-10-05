import { withPerm, type AuthUser } from '@/lib/foodhub/auth';
import { buildCommandCenter } from '@/lib/foodhub/command';
import { CHANNEL_LABELS } from '@/lib/foodhub/config';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { deviceStatus, listDevices } from '@/lib/foodhub/identity/devices';
import { aiConfigured } from '@/lib/foodhub/notify';
import { listCases, RECOVERABLE } from '@/lib/foodhub/recon/engine';
import { askClaude, COPILOT_SYSTEM } from '@/lib/foodhub/watch/ai';
import { listIncidents } from '@/lib/foodhub/watch/engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const money = (n: number) => `${n.toFixed(2).replace('.', ',')} $`;

async function snapshot(actor: AuthUser) {
  const cc = await buildCommandCenter({ locationCodes: actor.locations });
  const incidents = (await listIncidents({ status: ['open', 'acknowledged'], locationCodes: actor.locations.length ? actor.locations : undefined })).slice(0, 15);
  const devices = (await listDevices()).filter((d) => !d.revoked && (!actor.locations.length || actor.locations.includes(d.locationCode)));
  const cases = actor.locations.length ? [] : (await listCases({ status: ['open', 'disputed'] }).catch(() => [])).filter((c) => RECOVERABLE.includes(c.type));
  return {
    businessDay: cc.businessDay,
    kpis: cc.kpis,
    byChannel: cc.channels.map((c) => ({ platform: c.label, orders: c.orders, sales: c.sales, open: c.open, storesOnline: `${c.storesOnline}/${c.storesMapped}` })),
    byBrand: cc.byBrand.slice(0, 10),
    byLocation: cc.byLocation,
    openOrders: cc.queue.slice(0, 20).map((q) => ({ id: q.displayId, platform: CHANNEL_LABELS[q.channel], brand: q.brandName, location: q.locationCode, status: q.status, total: q.total, readyTarget: q.readyTarget, placed: q.createdAt })),
    incidents: incidents.map((i) => ({ severity: i.severity, title: i.title, status: i.status, since: i.openedAt })),
    tablets: devices.map((d) => ({ name: d.name, location: d.locationCode, status: deviceStatus(d) })),
    kitchen: cc.kitchen,
    moneyToRecover: Math.round(cases.reduce((a, c) => a + c.amount, 0) * 100) / 100,
    disputeCases: cases.length,
  };
}

type Snap = Awaited<ReturnType<typeof snapshot>>;

/** Answers without AI for the common questions (sales, late, stores, problems, tablets, money). */
function ruleAnswer(q: string, s: Snap, fr: boolean): string {
  const t = q.toLowerCase();
  const k = s.kpis;
  const has = (...w: string[]) => w.some((x) => t.includes(x));
  if (has('vente', 'sales', 'chiffre', 'revenue', 'combien', 'how much', 'made')) {
    const vs = k.yesterdaySameTime ? Math.round(((k.deliverySales - k.yesterdaySameTime) / k.yesterdaySameTime) * 100) : null;
    return fr
      ? `Aujourd’hui : ${money(k.combinedSales)} au total — ${money(k.deliverySales)} en livraison (${k.deliveryOrders} commandes, panier moyen ${money(k.avgTicket)}) + ${money(k.inStore)} en magasin (Clover).${vs !== null ? ` Livraison ${vs >= 0 ? '+' : ''}${vs} % vs hier à la même heure.` : ''}\nMeilleure marque : ${s.byBrand[0] ? `${s.byBrand[0].brandName} (${money(s.byBrand[0].sales)})` : '—'}.`
      : `Today: ${money(k.combinedSales)} total — ${money(k.deliverySales)} delivery (${k.deliveryOrders} orders, avg ${money(k.avgTicket)}) + ${money(k.inStore)} in store (Clover).${vs !== null ? ` Delivery ${vs >= 0 ? '+' : ''}${vs}% vs yesterday same time.` : ''}\nTop brand: ${s.byBrand[0] ? `${s.byBrand[0].brandName} (${money(s.byBrand[0].sales)})` : '—'}.`;
  }
  if (has('retard', 'late', 'lent', 'slow')) {
    const late = s.openOrders.filter((o) => o.status === 'accepted' && o.readyTarget && Date.parse(o.readyTarget) < Date.now());
    if (!late.length) return fr ? 'Aucune commande en retard en ce moment. 👍' : 'No late orders right now. 👍';
    return (fr ? `${late.length} commande(s) en retard :\n` : `${late.length} late order(s):\n`) + late.slice(0, 6).map((o) => `• ${o.platform} #${o.id} — ${o.brand ?? ''} ${o.location ?? ''}`).join('\n') + (fr ? '\n→ Commandes : marquez Prête ou ajoutez +5 min.' : '\n→ Orders: mark Ready or add +5 min.');
  }
  if (has('tablet', 'tablette', 'écran', 'screen', 'appareil', 'device')) {
    if (!s.tablets.length) return fr ? 'Aucune tablette enregistrée. Réglages → Tablettes pour en ajouter.' : 'No tablet enrolled yet. Settings → Tablets to add one.';
    return s.tablets.map((d) => `• ${d.name} (${d.location}) — ${d.status === 'online' ? (fr ? 'en ligne' : 'online') : d.status === 'offline' ? (fr ? 'HORS LIGNE' : 'OFFLINE') : (fr ? 'jamais connectée' : 'never connected')}`).join('\n');
  }
  if (has('magasin', 'store', 'ferm', 'pause', 'offline', 'hors ligne', 'ouvert', 'open')) {
    return fr
      ? `Magasins : ${k.storesOnline} en ligne sur ${k.storesMapped}, ${k.storesPaused} en pause, ${k.storesDeactivated} désactivé(s).\n${s.byChannel.map((c) => `• ${c.platform} : ${c.storesOnline} en ligne`).join('\n')}`
      : `Stores: ${k.storesOnline} online of ${k.storesMapped}, ${k.storesPaused} paused, ${k.storesDeactivated} deactivated.\n${s.byChannel.map((c) => `• ${c.platform}: ${c.storesOnline} online`).join('\n')}`;
  }
  if (has('argent', 'money', 'payout', 'paiement', 'récupér', 'recover', 'litige', 'dispute')) {
    return fr ? `${money(s.moneyToRecover)} à récupérer des plateformes (${s.disputeCases} cas). → Argent → Litiges.` : `${money(s.moneyToRecover)} to recover from the platforms (${s.disputeCases} cases). → Money → Disputes.`;
  }
  const crit = s.incidents.filter((i) => i.severity === 'critical');
  const head = fr
    ? `${s.incidents.length ? `${s.incidents.length} alerte(s) ouverte(s)${crit.length ? `, dont ${crit.length} critique(s)` : ''}.` : 'Tout va bien : aucune alerte ouverte.'}`
    : `${s.incidents.length ? `${s.incidents.length} open alert(s)${crit.length ? `, ${crit.length} critical` : ''}.` : 'All good: no open alerts.'}`;
  const list = s.incidents.slice(0, 5).map((i) => `• ${i.severity === 'critical' ? '🔴' : i.severity === 'warning' ? '🟠' : '🔵'} ${i.title}`).join('\n');
  const sales = fr ? `Ventes du jour : ${money(k.combinedSales)} · ${k.openOrders} commande(s) en cours.` : `Sales today: ${money(k.combinedSales)} · ${k.openOrders} open order(s).`;
  return [head, list, sales].filter(Boolean).join('\n');
}

// { question, lang } → an answer from today's data. Claude when ANTHROPIC_API_KEY is set, built-in answers otherwise.
export const POST = withPerm('view', async (req, _ctx, actor) => {
  const b = await readJson(req);
  const question = String(b.question || '').trim().slice(0, 500);
  if (!question) return fail('Posez une question. / Ask a question.');
  const fr = b.lang !== 'en';
  const snap = await snapshot(actor);
  if (aiConfigured()) {
    const answer = await askClaude(COPILOT_SYSTEM, `Language: ${fr ? 'French (Québec)' : 'English'}\nNow: ${new Date().toISOString()}\nSnapshot (JSON): ${JSON.stringify(snap).slice(0, 12000)}\n\nQuestion: ${question}`, 600);
    if (answer) return ok({ answer, source: 'claude' });
  }
  return ok({ answer: ruleAnswer(question, snap, fr), source: 'rules' });
});
