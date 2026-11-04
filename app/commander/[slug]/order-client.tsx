'use client';

// The ordering page in the customer's browser: category bar, item sheet (choices checked live against each group's
// min / max), the "make it a meal" step (Duo / Trio / Combo, offered once, never pre-selected), the cart drawer, the
// name / phone form and the payment choice. Prices shown here are for display only: the server prices every order
// again from the menu (lib/foodhub/storefront/cart.ts). Mobile first, 48 px touch targets.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { PublicCategory, PublicGroup, PublicItem, PublicMenu } from '@/lib/foodhub/storefront/catalog';
import { clockLabel, opensLabel, priceLabel, sfText, type SfLang } from '@/lib/foodhub/storefront/i18n';

import { CheckoutReview } from './checkout-review';
import { parseCart, readPendingCheckout, type Cart, type CheckoutOutcome, type PendingCheckout } from './checkout-browser';

type Picks = Record<string, Record<string, number>>;
interface Line { key: string; ref: string; qty: number; picks: Picks; notes?: string }
interface Last { track: string; number: string; at: number }

const r2 = (n: number) => Math.round(n * 100) / 100;
const L = (x: { name: string; nameFr?: string }, lang: SfLang) => (lang === 'fr' ? x.nameFr || x.name : x.name);
const D = (x: { description?: string; descriptionFr?: string }, lang: SfLang) => (lang === 'fr' ? x.descriptionFr || x.description : x.description);
const count = (p: Record<string, number> | undefined) => Object.values(p ?? {}).reduce((s, n) => s + n, 0);

function store<T>(key: string): T | null {
  try { const v = window.localStorage.getItem(key); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
}
function keep(key: string, v: unknown) {
  try { if (v === null) window.localStorage.removeItem(key); else window.localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ }
}

function unitPrice(item: PublicItem, picks: Picks): number {
  let p = item.price;
  for (const g of item.groups) for (const o of g.options) p += (picks[g.ref]?.[o.ref] ?? 0) * o.price;
  return r2(p);
}

function groupOk(g: PublicGroup, picks: Picks): boolean {
  const n = count(picks[g.ref]);
  return n >= g.min && n <= g.max;
}

/** Validate persisted native choices through the same bounded public cart contract. */
function browserCart(slug: string, value: unknown): Cart {
  if (!Array.isArray(value)) return { slug, lines: [] };
  const lines = value.map((line: Line) => {
    if (!line || !line.picks || typeof line.picks !== 'object' || Array.isArray(line.picks)) return null;
    try { return { id: line.key, ref: line.ref, qty: line.qty, notes: line.notes, options: Object.entries(line.picks).flatMap(([group, options]) => Object.entries(options).map(([ref, qty]) => ({ group, ref, qty }))) }; } catch { return null; }
  });
  return parseCart(slug, { slug, lines });
}
function nativeLines(cart: Cart): Line[] {
  return cart.lines.map((line) => ({ key: line.id, ref: line.ref, qty: line.qty, ...(line.notes ? { notes: line.notes } : {}), picks: line.options.reduce<Picks>((picks, option) => { picks[option.group] ??= {}; picks[option.group][option.ref] = option.qty ?? 1; return picks; }, {}) }));
}

export default function OrderClient({ menu, lang, src }: { menu: PublicMenu; lang: SfLang; src: string | null }) {
  const t = sfText(lang);
  const slug = menu.slug;
  const items = useMemo(() => new Map(menu.categories.flatMap((c) => c.items.map((i) => [i.ref, i] as const))), [menu]);
  const catOf = useMemo(() => new Map(menu.categories.flatMap((c) => c.items.map((i) => [i.ref, c] as const))), [menu]);
  const [cart, setCart] = useState<Line[]>([]);
  const [sheet, setSheet] = useState<{ item: PublicItem; picks: Picks; qty: number; notes: string } | null>(null);
  const [meal, setMeal] = useState<{ lineKey: string; item: PublicItem; group: PublicGroup | null; picks: Record<string, number> } | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [recovery, setRecovery] = useState<PendingCheckout | null>(null);
  const [hasPending, setHasPending] = useState(false);
  const pendingChanged = useCallback((value: boolean) => { setHasPending(value); if (!value) setRecovery(null); }, []);
  const [error, setError] = useState('');
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [last, setLast] = useState<Last | null>(null);
  const loaded = useRef(false);

  const canOrder = menu.state.open && !menu.state.paused;

  // Per-browser conveniences: the cart survives a reload; the last order links to its tracking page.
  useEffect(() => {
    const saved = store<Line[]>(`sf_cart:${slug}`);
    if (Array.isArray(saved)) setCart(nativeLines(browserCart(slug, saved)).filter((l) => items.has(l.ref)));
    try { const pending = readPendingCheckout(window.sessionStorage, slug); if (pending) { setRecovery(pending); setHasPending(true); setDrawer(true); setCart(nativeLines(parseCart(slug, { slug, lines: pending.request.lines }))); } } catch { /* private mode */ }
    const l = store<Last>(`sf_last:${slug}`);
    if (l && typeof l.track === 'string' && /^[A-Za-z0-9_-]{20,64}$/.test(l.track) && typeof l.number === 'string' && Number.isFinite(l.at) && Date.now() - l.at < 12 * 3600_000) setLast(l);
    loaded.current = true;
  }, [slug, items]);
  useEffect(() => { if (loaded.current) keep(`sf_cart:${slug}`, cart.length ? cart : null); }, [cart, slug]);

  const lines = cart.map((l) => ({ l, item: items.get(l.ref)! })).filter((x) => x.item);
  const subtotal = r2(lines.reduce((s, { l, item }) => s + unitPrice(item, l.picks) * l.qty, 0));
  const tax = r2(subtotal * menu.taxes.rate);
  const total = r2(subtotal + tax);
  const nItems = lines.reduce((s, { l }) => s + l.qty, 0);

  const openItem = (item: PublicItem) => {
    const c = catOf.get(item.ref);
    if (hasPending || !canOrder || (c && !c.available)) return;
    setSheet({ item, picks: {}, qty: 1, notes: '' });
  };

  const toggle = (g: PublicGroup, ref: string, picks: Picks): Picks => {
    const cur = { ...(picks[g.ref] ?? {}) };
    if (cur[ref]) delete cur[ref];
    else if (g.max === 1) return { ...picks, [g.ref]: { [ref]: 1 } };
    else if (count(cur) < g.max) cur[ref] = 1;
    return { ...picks, [g.ref]: cur };
  };

  const addFromSheet = () => {
    if (!sheet) return;
    const key = `${sheet.item.ref}-${Date.now().toString(36)}`;
    setCart((c) => [...c, { key, ref: sheet.item.ref, qty: sheet.qty, picks: sheet.picks, ...(sheet.notes.trim() ? { notes: sheet.notes.trim().slice(0, 140) } : {}) }].slice(-30));
    const upsells = sheet.item.groups.filter((g) => g.upsell);
    setSheet(null);
    // Offered once, right after the item is added; nothing is selected for the customer.
    if (upsells.length) setMeal({ lineKey: key, item: sheet.item, group: null, picks: {} });
  };

  const addMeal = () => {
    if (!meal?.group) return;
    const g = meal.group;
    setCart((c) => c.map((l) => (l.key === meal.lineKey ? { ...l, picks: { ...l.picks, [g.ref]: meal.picks } } : l)));
    setMeal(null);
  };

  const change = (key: string, d: number) => { if (hasPending) return; setCart((c) => c.flatMap((l) => (l.key !== key ? [l] : l.qty + d <= 0 ? [] : [{ ...l, qty: Math.min(20, l.qty + d) }]))); };

  const confirmed = useCallback((out: Extract<CheckoutOutcome, { ok: true }>) => {
    keep(`sf_last:${slug}`, { track: out.track, number: out.number, at: Date.now() } satisfies Last);
    keep(`sf_cart:${slug}`, null);
    setCart([]);
    window.location.href = out.payUrl || `${out.trackUrl}${lang === 'en' ? '?lang=en' : ''}`;
  }, [slug, lang]);

  const st = menu.state;
  const now = Date.parse(menu.generatedAt); // the instant the server built this menu (pure render)
  const statusLine = st.paused ? t.paused : st.open ? (st.closesAt ? `${t.open} · ${t.closesAt(clockLabel(Date.parse(st.closesAt), lang))}` : t.open)
    : !st.hoursKnown ? t.noHours : st.nextOpenAt ? `${t.closed} · ${opensLabel(Date.parse(st.nextOpenAt), now, lang)}` : t.closed;
  const other = lang === 'fr' ? 'en' : 'fr';
  const langHref = `/commander/${slug}?${new URLSearchParams({ ...(other === 'en' ? { lang: 'en' } : {}), ...(src ? { src } : {}) }).toString()}`;
  const note = lang === 'fr' ? menu.note.fr : menu.note.en || menu.note.fr;

  return (
    <div lang={lang === 'fr' ? 'fr-CA' : 'en-CA'} style={{ ['--sf-accent' as string]: menu.brand.color }} className="pb-28">
      <header className="sf-accent-bg">
        <div className="mx-auto flex max-w-3xl items-start justify-between gap-3 px-4 pb-5 pt-6">
          <div className="min-w-0">
            <h1 className="text-2xl font-extrabold leading-tight sm:text-3xl">{menu.brand.name}</h1>
            <p className="mt-1 text-sm font-semibold opacity-90">{t.pickupOnly} · {t.pickupAt} {menu.location.street}, {menu.location.city}</p>
          </div>
          <a href={langHref} className="sf-chip shrink-0 !border-transparent !bg-white/15 !text-inherit" hrefLang={other === 'en' ? 'en-CA' : 'fr-CA'}>{t.language}</a>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4">
        <div role="status" className={`mt-4 rounded-xl px-4 py-3 text-[15px] font-bold ${canOrder ? 'bg-[var(--sf-ok-soft)] text-[var(--sf-ok)]' : 'bg-[var(--sf-warn-soft)] text-[var(--sf-warn)]'}`}>{statusLine}</div>
        {note && <p className="mt-3 text-sm sf-muted">{note}</p>}
        {menu.brand.description && <p className="mt-3 text-sm sf-muted">{menu.brand.description[lang]}</p>}
        {last && (
          <a href={`/commander/${slug}/suivi/${last.track}${lang === 'en' ? '?lang=en' : ''}`} className="sf-card mt-4 flex min-h-12 items-center justify-between px-4 py-3 text-sm font-bold">
            <span>{t.lastOrder} · {t.number} {last.number}</span><span aria-hidden>→</span>
          </a>
        )}
      </div>

      <nav aria-label={t.categories} className="sticky top-0 z-10 mt-4 border-y border-[var(--sf-line)] bg-[var(--sf-bg)]/95 backdrop-blur">
        <div className="sf-noscroll mx-auto flex max-w-3xl gap-2 overflow-x-auto px-4 py-2">
          {menu.categories.map((c) => <a key={c.ref} href={`#cat-${c.ref}`} className="sf-chip">{L(c, lang)}</a>)}
        </div>
      </nav>

      <main className="mx-auto max-w-3xl px-4">
        {menu.categories.map((c: PublicCategory) => (
          <section key={c.ref} id={`cat-${c.ref}`} className="scroll-mt-16 pt-6">
            <h2 className="flex flex-wrap items-baseline gap-2 text-xl font-extrabold">
              {L(c, lang)}
              {!c.available && <span className="text-sm font-bold sf-muted">{c.availableFrom ? t.from(clockLabel(Date.parse(c.availableFrom), lang)) : t.closed}</span>}
            </h2>
            <ul className="mt-3 grid gap-3">
              {c.items.map((i) => {
                const off = hasPending || !canOrder || !c.available;
                return (
                  <li key={i.ref}>
                    <button type="button" onClick={() => openItem(i)} disabled={off} aria-disabled={off}
                      className={`sf-card flex w-full min-h-[88px] items-stretch gap-3 p-3 text-left ${off ? 'opacity-55' : 'hover:border-[var(--sf-accent)]'}`}>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[16px] font-extrabold">{L(i, lang)}</span>
                        {D(i, lang) && <span className="mt-1 line-clamp-2 block text-sm sf-muted">{D(i, lang)}</span>}
                        <span className="mt-2 block text-[15px] font-bold">{priceLabel(i.price, lang)}</span>
                      </span>
                      {i.imageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={i.imageUrl} alt="" loading="lazy" className="size-24 shrink-0 rounded-lg object-cover" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        <p className="mt-10 text-center text-xs sf-muted">{t.poweredBy} {t.alcoholNote}</p>
      </main>

      {(nItems > 0 || hasPending) && !drawer && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[var(--sf-line)] bg-[var(--sf-surface)] p-3">
          <button type="button" onClick={() => setDrawer(true)} className="sf-btn sf-accent-bg mx-auto flex w-full max-w-3xl justify-between">
            <span>{t.viewCart} · {nItems}</span><span>{priceLabel(subtotal, lang)}</span>
          </button>
        </div>
      )}

      {sheet && (
        <Sheet onClose={() => setSheet(null)} title={L(sheet.item, lang)} closeLabel={t.close}>
          {sheet.item.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={sheet.item.imageUrl} alt="" className="mb-3 h-44 w-full rounded-xl object-cover" />
          )}
          {D(sheet.item, lang) && <p className="text-sm sf-muted">{D(sheet.item, lang)}</p>}
          {sheet.item.allergens.length > 0 && <p className="mt-2 text-xs sf-muted">{t.allergensList(sheet.item.allergens.join(', '))}</p>}
          {sheet.item.groups.filter((g) => !g.upsell).map((g) => (
            <GroupPicker key={g.ref} g={g} lang={lang} picked={sheet.picks[g.ref] ?? {}} onToggle={(ref) => setSheet({ ...sheet, picks: toggle(g, ref, sheet.picks) })} />
          ))}
          <label className="mt-4 block text-sm font-bold">{t.notes}
            <input className="sf-input mt-1" maxLength={140} placeholder={t.notesHint} value={sheet.notes} onChange={(e) => setSheet({ ...sheet, notes: e.target.value })} />
          </label>
          <div className="mt-5 flex items-center gap-3">
            <Stepper value={sheet.qty} onChange={(q) => setSheet({ ...sheet, qty: q })} labels={{ less: t.decrease, more: t.increase }} />
            <button type="button" className="sf-btn sf-accent-bg flex-1" disabled={!sheet.item.groups.filter((g) => !g.upsell).every((g) => groupOk(g, sheet.picks))} onClick={addFromSheet}>
              {t.addFor(priceLabel(r2(unitPrice(sheet.item, sheet.picks) * sheet.qty), lang))}
            </button>
          </div>
        </Sheet>
      )}

      {meal && (
        <Sheet onClose={() => setMeal(null)} title={t.meal} closeLabel={t.close}>
          {!meal.group ? (
            <>
              <p className="text-sm sf-muted">{t.mealIntro}</p>
              <ul className="mt-3 grid gap-2">
                {meal.item.groups.filter((g) => g.upsell).map((g) => (
                  <li key={g.ref}>
                    <button type="button" className="sf-card flex min-h-14 w-full items-center justify-between px-4 text-left font-bold" onClick={() => setMeal({ ...meal, group: g, picks: {} })}>
                      <span>{L(g, lang)}</span><span>+{priceLabel(Math.min(...g.options.map((o) => o.price)), lang)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" className="sf-btn mt-4 w-full border border-[var(--sf-line)]" onClick={() => setMeal(null)}>{t.mealNo}</button>
            </>
          ) : (
            <>
              <GroupPicker g={{ ...meal.group, min: Math.max(1, meal.group.min) }} lang={lang} title={t.mealPickDrink} picked={meal.picks}
                onToggle={(ref) => setMeal({ ...meal, picks: toggle(meal.group!, ref, { [meal.group!.ref]: meal.picks })[meal.group!.ref] ?? {} })} />
              <div className="mt-5 grid gap-2">
                <button type="button" className="sf-btn sf-accent-bg w-full" disabled={count(meal.picks) < Math.max(1, meal.group.min) || count(meal.picks) > meal.group.max} onClick={addMeal}>{t.add}</button>
                <button type="button" className="sf-btn w-full border border-[var(--sf-line)]" onClick={() => setMeal(null)}>{t.mealNo}</button>
              </div>
            </>
          )}
        </Sheet>
      )}

      {drawer && (
        <Sheet onClose={() => setDrawer(false)} title={t.cart} closeLabel={t.close}>
          {!lines.length && !hasPending && <p className="sf-muted">{t.emptyCart}</p>}
          <ul className="grid gap-3">
            {lines.map(({ l, item }) => {
              const opts = item.groups.flatMap((g) => g.options.filter((o) => l.picks[g.ref]?.[o.ref]).map((o) => L(o, lang)));
              return (
                <li key={l.key} className="flex items-start justify-between gap-3 border-b border-[var(--sf-line)] pb-3">
                  <div className="min-w-0">
                    <div className="font-extrabold">{L(item, lang)}</div>
                    {opts.length > 0 && <div className="text-sm sf-muted">{opts.join(', ')}</div>}
                    {l.notes && <div className="text-sm sf-muted">« {l.notes} »</div>}
                    <div className="mt-2"><Stepper disabled={hasPending} value={l.qty} onChange={(q) => change(l.key, q - l.qty)} allowZero labels={{ less: t.decrease, more: t.increase }} /></div>
                  </div>
                  <div className="shrink-0 font-bold">{priceLabel(r2(unitPrice(item, l.picks) * l.qty), lang)}</div>
                </li>
              );
            })}
          </ul>
          {(lines.length > 0 || hasPending) && (
            <>
              <dl className="mt-4 grid grid-cols-[1fr_auto] gap-y-1 text-[15px]">
                <dt className="sf-muted">{t.subtotal}</dt><dd>{priceLabel(subtotal, lang)}</dd>
                <dt className="sf-muted">{menu.taxes.label[lang]}</dt><dd>{priceLabel(tax, lang)}</dd>
                <dt className="font-extrabold">{lang === 'fr' ? 'Total estimé' : 'Estimated total'}</dt><dd className="font-extrabold">{priceLabel(total, lang)}</dd>
              </dl>
              {error && <p role="alert" className="mt-4 rounded-lg bg-[var(--sf-warn-soft)] px-3 py-2 text-sm font-bold text-[var(--sf-warn)]">{error}</p>}
              {needsRefresh && <button type="button" className="sf-btn mt-3 w-full border border-[var(--sf-line)]" onClick={() => window.location.reload()}>{lang === 'fr' ? 'Actualiser le menu' : 'Refresh menu'}</button>}
              <div className="mt-5"><CheckoutReview cart={browserCart(slug, cart)} menu={menu} lang={lang} src={src} recovery={recovery}
                onBack={() => setDrawer(false)} onSuccess={confirmed} onPendingChange={pendingChanged}
                onRefreshMenu={() => setNeedsRefresh(true)} onInvalidLine={(_line, message) => setError(message)} /></div>
            </>
          )}
        </Sheet>
      )}
    </div>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** A modal sheet: focus moves into it on open, stays inside (Tab / Shift+Tab), Escape closes, focus returns on close. */
function Sheet({ title, onClose, closeLabel, children }: { title: string; onClose: () => void; closeLabel: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const headingId = useId();
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    box.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { close.current(); return; }
      if (e.key !== 'Tab' || !box.current) return;
      const list = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      const at = document.activeElement;
      if (!box.current.contains(at)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && at === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', k);
      document.body.style.overflow = prev;
      if (back?.isConnected) back.focus();
    };
  }, []);
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/45 sm:items-center" onClick={() => close.current()}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby={headingId} onClick={(e) => e.stopPropagation()}
        className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-[var(--sf-surface)] p-5 text-[var(--sf-ink)] sm:rounded-2xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 id={headingId} className="text-xl font-extrabold">{title}</h2>
          <button type="button" data-autofocus onClick={() => close.current()} aria-label={closeLabel} className="grid size-12 shrink-0 place-items-center rounded-full bg-[var(--sf-sunken)] text-xl font-bold"><span aria-hidden>×</span></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function GroupPicker({ g, lang, picked, onToggle, title }: { g: PublicGroup; lang: SfLang; picked: Record<string, number>; onToggle: (ref: string) => void; title?: string }) {
  const t = sfText(lang);
  const n = count(picked);
  const ok = n >= g.min && n <= g.max;
  const single = g.max === 1;
  return (
    <fieldset className="mt-5">
      <legend className="flex w-full flex-wrap items-baseline justify-between gap-2">
        <span className="text-[16px] font-extrabold">{title ?? L(g, lang)}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${g.min > 0 ? (ok ? 'bg-[var(--sf-ok-soft)] text-[var(--sf-ok)]' : 'bg-[var(--sf-warn-soft)] text-[var(--sf-warn)]') : 'bg-[var(--sf-sunken)] sf-muted'}`}>
          {g.min > 0 ? t.required : t.optional} · {t.chooseN(g.min, g.max)}
        </span>
      </legend>
      <ul className="mt-2 grid gap-2">
        {g.options.map((o) => {
          const on = Boolean(picked[o.ref]);
          const full = !on && !single && n >= g.max;
          return (
            <li key={o.ref}>
              <label className={`flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-xl border px-4 ${on ? 'border-[var(--sf-accent)] bg-[var(--sf-sunken)]' : 'border-[var(--sf-line)]'} ${full ? 'opacity-50' : ''}`}>
                <span className="flex items-center gap-3">
                  <input type={single ? 'radio' : 'checkbox'} name={`g-${g.ref}`} checked={on} disabled={full} onChange={() => onToggle(o.ref)} className="size-5 accent-[var(--sf-accent)]" />
                  <span className="font-semibold">{L(o, lang)}</span>
                </span>
                {o.price > 0 && <span className="text-sm font-bold">+{priceLabel(o.price, lang)}</span>}
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

function Stepper({ value, onChange, allowZero, disabled = false, labels }: { value: number; onChange: (v: number) => void; allowZero?: boolean; disabled?: boolean; labels: { less: string; more: string } }) {
  return (
    <div className="inline-flex items-center rounded-xl border border-[var(--sf-line)]">
      <button type="button" aria-label={labels.less} className="grid size-12 place-items-center text-xl font-bold" disabled={disabled || (!allowZero && value <= 1)} onClick={() => onChange(Math.max(allowZero ? 0 : 1, value - 1))}>−</button>
      <span className="w-8 text-center font-extrabold" aria-live="polite">{value}</span>
      <button type="button" aria-label={labels.more} className="grid size-12 place-items-center text-xl font-bold" disabled={disabled || value >= 20} onClick={() => onChange(Math.min(20, value + 1))}>+</button>
    </div>
  );
}
