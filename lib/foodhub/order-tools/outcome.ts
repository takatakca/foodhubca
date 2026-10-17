// Kitchen order tools — what really happened on the platforms, from the per-store result rows the existing routes
// return. A row's `ok` is true for done, queued AND skipped (lib/foodhub/config.ts result()), so `ok` alone would count a
// store that was never sent (menu locked, "Do not touch", not one of the brand's dishes) as changed. Here:
//   changed  = done or queued (the platform got it)
//   skipped  = skipped (nothing sent — said plainly in the toast)
//   blocked  = blocked (refused before sending: credentials, sandbox, guard)
//   failed   = anything else (the platform answered with an error)
//
// Pure: the screens and the tests use it.

export interface ResultRow { channel?: string; brandName?: string; result: { ok?: boolean; status?: string; message: string } }

export interface Outcome<R extends ResultRow = ResultRow> {
  changed: R[];
  skipped: R[];
  blocked: R[];
  failed: R[];
}

export function outcomeOf<R extends ResultRow>(rows: R[]): Outcome<R> {
  const out: Outcome<R> = { changed: [], skipped: [], blocked: [], failed: [] };
  for (const r of rows) {
    const s = r.result.status;
    if (s === 'done' || s === 'queued') out.changed.push(r);
    else if (s === 'skipped') out.skipped.push(r);
    else if (s === 'blocked') out.blocked.push(r);
    else out.failed.push(r);
  }
  return out;
}

/** One line per store that did not change: "doordash · Alpha: Not sent — …". */
export function notChangedLines(o: Outcome): string[] {
  return [...o.skipped, ...o.blocked, ...o.failed].map((r) => `${[r.channel, r.brandName].filter(Boolean).join(' · ')}: ${r.result.message}`);
}

type Lang = (fr: string, en: string) => string;

/** Honest toast for an 86 from an order line. */
export function quick86Headline(t: Lang, rows: ResultRow[]): { kind: 'success' | 'warn' | 'error'; title: string } {
  const o = outcomeOf(rows);
  const n = o.changed.length;
  const notSent = o.skipped.length;
  const refused = o.blocked.length + o.failed.length;
  if (!rows.length) return { kind: 'warn', title: t('Noté dans Food Hub — aucun magasin de plateforme relié ici', 'Saved in Food Hub — no platform store mapped here') };
  if (n && !notSent && !refused) return { kind: 'success', title: t(`En rupture sur ${n} magasin(s)`, `Out of stock on ${n} store(s)`) };
  if (n) {
    const rest = [notSent ? t(`${notSent} non envoyé(s)`, `${notSent} not sent`) : '', refused ? t(`${refused} refusé(s)`, `${refused} refused`) : ''].filter(Boolean).join(', ');
    return { kind: 'warn', title: t(`En rupture sur ${n} magasin(s) — ${rest}`, `Out of stock on ${n} store(s) — ${rest}`) };
  }
  if (!refused) return { kind: 'warn', title: t('Rien n’a été envoyé aux plateformes (verrouillé / « Ne pas toucher » / pas un plat de la marque)', 'Nothing was sent to the platforms (locked / “Do not touch” / not one of the brand’s dishes)') };
  return { kind: 'error', title: t('Les plateformes n’ont pas pris la rupture', 'The platforms did not take the 86') };
}
