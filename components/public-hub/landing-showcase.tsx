import type { CSSProperties, ReactNode } from 'react';
import { LEGAL_PATHS } from '@/lib/foodhub/legal';
import type { HubPlatform, Lang } from '@/lib/foodhub/pricing';
import { pendingPlatforms, type HubContext } from '@/lib/foodhub/public-hub';
import { SHOWCASE, type DemoOrder } from '@/lib/foodhub/public-hub-showcase';
import styles from './landing.module.css';

// The premium visuals of the public landing (/hub, /en/hub): a live device in the hero, the "one brain" diagram, the
// tablet and menu showcases, a feature explorer you click, the integrations panel and a facts band. Server-rendered
// and CSS only (tests/public-hub.test.ts forbids page scripts): the tabs are radio buttons, the motion is CSS and SVG,
// and everything stops under prefers-reduced-motion. The orders shown are an illustration, hidden from screen readers.
// Words: lib/foodhub/public-hub-showcase.ts. Tests: tests/public-hub-showcase.test.ts.

const PILL: Record<DemoOrder['platform'], string> = { uber: 'bg-uber', doordash: 'bg-doordash', skip: 'bg-skip' };
const DELIVERY: Array<{ key: HubPlatform; name: string; color: string }> = [
  { key: 'uber', name: 'Uber Eats', color: 'bg-uber' },
  { key: 'doordash', name: 'DoorDash', color: 'bg-doordash' },
  { key: 'skip', name: 'SkipTheDishes', color: 'bg-skip' },
];
const delay = (s: number): CSSProperties => ({ animationDelay: `${s}s` });

/** Small stroke icons for the feature explorer (24 × 24). */
const ICONS: Record<string, ReactNode> = {
  orders: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
  kitchen: <><path d="M6 14a6 6 0 0 1 12 0" /><path d="M4 14h16v3H4z" /><path d="M12 5v3" /></>,
  menus: <><path d="M5 4h14v16H5z" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
  soldout: <><circle cx="12" cy="12" r="8" /><path d="m6.5 6.5 11 11" /></>,
  stores: <><path d="M4 10h16l-1.5-5h-13z" /><path d="M5 10v9h14v-9" /><path d="M10 19v-5h4v5" /></>,
  money: <><circle cx="12" cy="12" r="8" /><path d="M14.5 9.5c-.5-1-1.5-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1 2-2.5 2c-1 0-2-.5-2.5-1.5M12 6.5v11" /></>,
  alerts: <><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20a2 2 0 0 0 4 0" /></>,
  team: <><circle cx="9" cy="9" r="3" /><circle cx="17" cy="10" r="2.5" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0M14.5 15.5a4.5 4.5 0 0 1 6 3.5" /></>,
};

function Icon({ id, className }: { id: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      {ICONS[id]}
    </svg>
  );
}

/** Twinkling points behind the hero (decorative). */
export function HeroSparkles() {
  const points = [[8, 18], [22, 70], [35, 30], [48, 82], [62, 12], [74, 58], [86, 26], [93, 76], [15, 48], [55, 45]];
  return (
    <div aria-hidden="true" className={styles.sparkles}>
      {points.map(([x, y], i) => <i key={`${x}-${y}`} style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${(i * 0.53) % 4.8}s` }} />)}
    </div>
  );
}

/** The hero's live device: a new order rings, is accepted and goes to Clover and the kitchen. */
export function HeroDevice({ lang }: { lang: Lang }) {
  const w = SHOWCASE[lang];
  const [first, ...rest] = w.orders;
  const chipPos = ['-left-3 top-6 sm:-left-8', '-right-2 top-1/3 sm:-right-6', 'left-6 -bottom-4'];
  return (
    <figure className={`${styles.stage} relative mx-auto w-full max-w-[460px]`}>
      <div aria-hidden="true" className={styles.device}>
        <div className={styles.screen}>
          <div className="flex items-center justify-between border-b border-[#e3e7ee] bg-white px-4 py-3">
            <div>
              <p className="text-[13px] font-extrabold text-[#0b1220]">{w.live}</p>
              <p className="text-[11px] text-[#5c6677]">{w.liveSub}</p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e6f6ed] px-2.5 py-1 text-[11px] font-bold text-[#0b7f48]">
              <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-[#0e9f5a] opacity-60 motion-reduce:animate-none" /><span className="relative inline-flex size-2 rounded-full bg-[#0e9f5a]" /></span>
              {lang === 'fr' ? 'En direct' : 'Live'}
            </span>
          </div>
          <div className="space-y-2.5 p-3">
            <div className={`${styles.orderIn} ${styles.ringing} rounded-xl border-2 border-[#1f8bff] bg-white p-3`}>
              <div className="flex items-center justify-between gap-2">
                <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold text-white ${PILL[first.platform]}`}>{first.label}</span>
                <span className="text-[11px] font-bold uppercase tracking-wide text-[#1565d8]">{w.newOrder}</span>
              </div>
              <div className="mt-2 flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[15px] font-extrabold text-[#0b1220]">#{first.ref}</p>
                  <p className="truncate text-[12px] text-[#3d4757]">{first.items}</p>
                </div>
                <div className="text-right">
                  <p className="text-[15px] font-extrabold tabular-nums text-[#0b1220]">{first.total}</p>
                  <span className={`${styles.acceptBtn} mt-1 inline-flex rounded-lg bg-[#1565d8] px-3 py-1.5 text-[12px] font-extrabold text-white`}>{w.accept}</span>
                </div>
              </div>
            </div>
            {rest.map((o, i) => (
              <div key={o.ref} className={`${styles.slideRow} flex items-center justify-between gap-2 rounded-xl border border-[#e3e7ee] bg-white px-3 py-2.5`} style={delay(0.4 + i * 0.3)}>
                <div className="flex min-w-0 items-center gap-2">
                  <span className={`h-8 w-1.5 shrink-0 rounded-full ${PILL[o.platform]}`} />
                  <div className="min-w-0">
                    <p className="text-[13px] font-bold text-[#0b1220]">{o.label} · #{o.ref}</p>
                    <p className="truncate text-[11px] text-[#5c6677]">{o.items}</p>
                  </div>
                </div>
                <span className="shrink-0 rounded-full bg-[#eceff5] px-2 py-0.5 text-[11px] font-bold text-[#3d4757]">{o.state}</span>
              </div>
            ))}
            <div className={`${styles.toast} flex items-center gap-2 rounded-xl bg-[#060d1f] px-3 py-2.5 text-[12px] font-semibold text-white`}>
              <span className="grid size-5 place-items-center rounded-full bg-[#0e9f5a] text-[11px]">✓</span>
              <span>{w.sentToClover} · {w.printed}</span>
            </div>
          </div>
          <span className={styles.glare} />
        </div>
      </div>
      {w.chips.map((c, i) => (
        <span key={c} aria-hidden="true" className={`${styles.floatChip} ${chipPos[i]}`} style={delay(i * 1.2)}>
          <span className="text-cyan">◆</span>{c}
        </span>
      ))}
      <figcaption className="mt-6 text-center text-[12px] text-silver">{w.demoNote}</figcaption>
    </figure>
  );
}

/** The "one brain" band: three platforms flow into TAKATAK Food Hub, which feeds Clover and the kitchen. */
function BrainSection({ lang }: { lang: Lang }) {
  const w = SHOWCASE[lang];
  const left = [
    { y: 90, name: 'Uber Eats', color: '#06c167' },
    { y: 210, name: 'DoorDash', color: '#ff3008' },
    { y: 330, name: 'SkipTheDishes', color: '#f57c00' },
  ];
  const right = [
    { y: 140, name: w.register, sub: w.registerSub, color: '#1c9b4b' },
    { y: 280, name: w.kitchen, sub: w.kitchenSub, color: '#1f8bff' },
  ];
  const inPath = (y: number) => `M150 ${y} C 220 ${y}, 230 210, 262 210`;
  const backPath = (y: number) => `M150 ${y + 10} C 225 ${y + 10}, 235 222, 262 222`;
  const outPath = (y: number) => `M338 210 C 380 210, 390 ${y}, 450 ${y}`;
  return (
    <section aria-labelledby="cerveau-title" className="relative overflow-hidden bg-rail text-white">
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className={styles.reveal}>
          <p className="text-[13px] font-bold uppercase tracking-[0.12em] text-cyan">{w.brainEyebrow}</p>
          <h2 id="cerveau-title" className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">{w.brainTitle}</h2>
          <p className="mt-4 text-[17px] leading-relaxed text-silver">{w.brainLead}</p>
          <ol className="mt-7 space-y-4">
            {w.brainSteps.map((s, i) => (
              <li key={s.title} className="flex gap-4">
                <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-cyan to-electric font-extrabold text-rail shadow-[0_0_24px_rgb(41_195_255/0.45)]">{i + 1}</span>
                <div>
                  <h3 className="font-bold">{s.title}</h3>
                  <p className="mt-1 text-[15px] leading-relaxed text-silver">{s.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <svg viewBox="0 0 600 420" role="img" aria-label={`${w.brainTitle}. ${left.map((n) => n.name).join(', ')} → ${w.core} → ${right.map((n) => n.name).join(', ')}`} className={`${styles.diagram} w-full`}>
          <defs>
            <radialGradient id="hub-core" cx="50%" cy="40%" r="60%"><stop offset="0%" stopColor="#29c3ff" /><stop offset="60%" stopColor="#1565d8" /><stop offset="100%" stopColor="#0b1b3d" /></radialGradient>
            <linearGradient id="hub-wire" x1="0" x2="1"><stop offset="0%" stopColor="#29c3ff" stopOpacity="0.2" /><stop offset="100%" stopColor="#29c3ff" /></linearGradient>
          </defs>
          <circle cx="300" cy="210" r="150" fill="none" stroke="#29c3ff" strokeOpacity="0.12" />
          <g className={styles.orbitRing}>
            <circle cx="300" cy="210" r="118" fill="none" stroke="#29c3ff" strokeOpacity="0.35" strokeDasharray="2 10" />
            <circle cx="418" cy="210" r="4" fill="#29c3ff" />
          </g>
          {left.map((n) => (
            <g key={n.name}>
              <path d={inPath(n.y)} fill="none" stroke="url(#hub-wire)" strokeWidth="3" className={styles.flow} />
              <path d={backPath(n.y)} fill="none" stroke="#b8c4d3" strokeOpacity="0.35" strokeWidth="1.5" className={styles.flowOut} />
            </g>
          ))}
          {right.map((n) => <path key={n.name} d={outPath(n.y)} fill="none" stroke="url(#hub-wire)" strokeWidth="3" className={styles.flow} />)}
          {left.map((n, i) => (
            <circle key={`p-${n.name}`} r="5" fill="#ffffff" className={styles.packet}>
              <animateMotion dur="2.6s" begin={`${i * 0.7}s`} repeatCount="indefinite" path={inPath(n.y)} />
            </circle>
          ))}
          {right.map((n, i) => (
            <circle key={`q-${n.name}`} r="5" fill="#29c3ff" className={styles.packet}>
              <animateMotion dur="2.2s" begin={`${1.3 + i * 0.6}s`} repeatCount="indefinite" path={outPath(n.y)} />
            </circle>
          ))}
          <circle cx="300" cy="210" r="46" fill="none" stroke="#29c3ff" strokeWidth="2" className={styles.halo} />
          <g className={styles.core}>
            <circle cx="300" cy="210" r="48" fill="url(#hub-core)" stroke="#29c3ff" strokeWidth="1.5" />
            <text x="300" y="207" textAnchor="middle" fill="#ffffff" fontSize="15" fontWeight="800">{w.core}</text>
            <text x="300" y="225" textAnchor="middle" fill="#b8c4d3" fontSize="10" fontWeight="700" letterSpacing="2">{w.coreSub}</text>
          </g>
          {left.map((n) => (
            <g key={`n-${n.name}`} className={styles.node}>
              <rect x="14" y={n.y - 24} width="136" height="48" rx="14" fill="#0b1b3d" stroke={n.color} strokeWidth="1.5" />
              <circle cx="36" cy={n.y} r="7" fill={n.color} />
              <text x="50" y={n.y + 5} fill="#ffffff" fontSize="13" fontWeight="700">{n.name}</text>
            </g>
          ))}
          {right.map((n) => (
            <g key={`m-${n.name}`} className={styles.node}>
              <rect x="450" y={n.y - 28} width="136" height="56" rx="14" fill="#0b1b3d" stroke={n.color} strokeWidth="1.5" />
              <circle cx="472" cy={n.y} r="7" fill={n.color} />
              <text x="486" y={n.y - 2} fill="#ffffff" fontSize="14" fontWeight="800">{n.name}</text>
              <text x="486" y={n.y + 14} fill="#b8c4d3" fontSize="10.5">{n.sub}</text>
            </g>
          ))}
        </svg>
      </div>
    </section>
  );
}

/** The two showcase cards: one screen for every tablet, one menu for every platform. */
function ShowcaseCards({ lang }: { lang: Lang }) {
  const w = SHOWCASE[lang];
  return (
    <div className="grid gap-6 py-14 lg:grid-cols-2">
      <article className={`${styles.glow} ${styles.reveal} rounded-2xl border border-line bg-surface p-6 shadow-card`}>
        <div aria-hidden="true" className={styles.tablet}>
          <div className="rounded-2xl bg-[#0b1220] p-3">
            <div className="mb-2 flex items-center justify-between text-[12px] font-bold text-silver">
              <span>{w.tabletHeader}</span>
              <span className="rounded-full bg-[#1565d8] px-2 py-0.5 text-white">{w.orders.length}</span>
            </div>
            <ul className="space-y-2">
              {w.orders.map((o, i) => (
                <li key={o.ref} className={`${styles.slideRow} flex items-center gap-3 rounded-xl bg-[#16294f] px-3 py-2.5 text-white`} style={delay(i * 0.45)}>
                  <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${PILL[o.platform]}`}>{o.label}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-silver">{o.items}</span>
                  <span className="text-[12px] font-bold tabular-nums">{`${4 + i * 3}:0${i}`}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <h3 className="mt-6 text-xl font-extrabold tracking-tight text-ink">{w.tabletTitle}</h3>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{w.tabletText}</p>
      </article>

      <article className={`${styles.glow} ${styles.reveal} rounded-2xl border border-line bg-surface p-6 shadow-card`}>
        <div aria-hidden="true" className="grid grid-cols-[minmax(0,1fr)_52px_auto] items-stretch rounded-2xl bg-rail p-4 text-white">
          <div className="rounded-xl bg-rail-2 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-cyan">{w.menuMaster}</p>
            <ul className="mt-2 space-y-1.5 text-[13px]">
              {w.menuItems.map((m, i) => (
                <li key={m} className={`flex items-center justify-between gap-2 ${i === 2 ? styles.soldOutRow : ''}`}>
                  <span className="truncate">{m}</span>
                  {i === 2 && <span className={`${styles.soldOutTag} rounded bg-[#e23b3e] px-1.5 text-[10px] font-bold text-white`}>{w.soldOut}</span>}
                </li>
              ))}
            </ul>
          </div>
          <svg viewBox="0 0 52 150" preserveAspectRatio="none" className="h-full w-full">
            {[25, 75, 125].map((y) => <path key={y} d={`M0 75 C 26 75, 26 ${y}, 52 ${y}`} fill="none" stroke="#29c3ff" strokeWidth="2" className={styles.wire} />)}
          </svg>
          <ul className="flex flex-col justify-between gap-2">
            {DELIVERY.map((p, i) => (
              <li key={p.key} className="flex items-center gap-2 rounded-lg bg-rail-2 px-2.5 py-2 text-[12px] font-bold">
                <span className={`size-2.5 rounded-full ${p.color}`} />
                {p.name}
                <span className={`${styles.check} ml-1 grid size-4 place-items-center rounded-full bg-[#0e9f5a] text-[10px]`} style={delay(i * 0.25)}>✓</span>
              </li>
            ))}
          </ul>
        </div>
        <h3 className="mt-6 text-xl font-extrabold tracking-tight text-ink">{w.menuTitle}</h3>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{w.menuText}</p>
      </article>
    </div>
  );
}

/** Click a feature: CSS-only tabs (radio buttons + :has); without :has every panel shows, one under the other. */
function FeatureExplorer({ lang }: { lang: Lang }) {
  const w = SHOWCASE[lang];
  return (
    <section aria-labelledby="explorer-title" className="border-t border-line py-14">
      <p className="text-[13px] font-bold uppercase tracking-[0.12em] text-brand">{w.explorerEyebrow}</p>
      <h2 id="explorer-title" className="mt-2 text-3xl font-extrabold tracking-tight text-ink">{w.explorerTitle}</h2>
      <p className="mt-3 max-w-3xl text-[16px] leading-relaxed text-ink-2">{w.explorerLead}</p>
      <div className={`${styles.explorer} mt-8`}>
        <fieldset>
          <legend className="sr-only">{w.explorerTitle}</legend>
          <div className="flex flex-wrap gap-2">
            {w.features.map((f, i) => (
              <span key={f.id}>
                <input type="radio" name="hub-feature" id={`hub-feature-${f.id}`} value={f.id} defaultChecked={i === 0} className={styles.tabInput} />
                <label htmlFor={`hub-feature-${f.id}`} className={styles.tabLabel}>
                  <Icon id={f.id} className="size-5" />{f.tab}
                </label>
              </span>
            ))}
          </div>
        </fieldset>
        {w.features.map((f) => (
          <div key={f.id} data-tab={f.id} className={`${styles.panel} mt-6 items-center gap-8 rounded-2xl border border-line bg-surface p-6 shadow-card md:grid-cols-[auto_minmax(0,1fr)] md:p-8`}>
            <div className={`${styles.bigIcon} mx-auto md:mx-0`}><Icon id={f.id} className="size-16" /></div>
            <div>
              <h3 className="text-2xl font-extrabold tracking-tight text-ink">{f.title}</h3>
              <p className="mt-3 max-w-2xl text-[16px] leading-relaxed text-ink-2">{f.text}</p>
              <ul className="mt-5 flex flex-wrap gap-2">
                {f.points.map((p) => (
                  <li key={p} className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1.5 text-[13px] font-bold text-brand">
                    <span aria-hidden="true">✓</span>{p}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** The platforms and the register, each with its real state: available, or in certification until approved. */
function IntegrationsPanel({ lang, ctx }: { lang: Lang; ctx: HubContext }) {
  const w = SHOWCASE[lang];
  const pending = pendingPlatforms(ctx);
  const otherPosHref = ctx.supportEmail ? `mailto:${ctx.supportEmail}` : LEGAL_PATHS.support;
  const colon = lang === 'fr' ? ' : ' : ': ';
  return (
    <section id={lang === 'fr' ? 'branchements' : 'connections'} aria-labelledby="branchements-title" className="border-t border-line py-14">
      <h2 id="branchements-title" className="text-3xl font-extrabold tracking-tight text-ink">{w.integrationsTitle}</h2>
      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className={`${styles.glow} rounded-2xl border border-line bg-surface p-6 shadow-card`}>
          <h3 className="text-lg font-extrabold text-ink">{w.deliveryTitle}</h3>
          <p className="mt-1 text-[15px] text-ink-2">{w.deliveryText}</p>
          <ul className="mt-5 grid gap-3 sm:grid-cols-3">
            {DELIVERY.map((p) => {
              const live = !pending.includes(p.key);
              return (
                <li key={p.key} className="rounded-xl border border-line bg-raised p-4 transition hover:-translate-y-0.5 hover:border-brand">
                  <span aria-hidden="true" className={`block h-1.5 w-10 rounded-full ${p.color}`} />
                  <p className="mt-3 font-extrabold text-ink">{p.name}</p>
                  <p className={`mt-2 inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-bold ${live ? 'bg-go-soft text-go-2' : 'bg-wait-soft text-ink'}`}>
                    {live ? w.connected : w.certifying}
                  </p>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 text-[14px] text-ink-3">{`Too Good To Go${colon}${w.tgtgCondition}.`}</p>
        </div>
        <div className={`${styles.glow} rounded-2xl border border-line bg-surface p-6 shadow-card`}>
          <h3 className="text-lg font-extrabold text-ink">{w.posTitle}</h3>
          <p className="mt-1 text-[15px] text-ink-2">{w.posText}</p>
          <div className="mt-5 flex items-center gap-3 rounded-xl border border-line bg-raised p-4">
            <span aria-hidden="true" className="grid size-10 place-items-center rounded-lg bg-clover text-lg font-black text-white">C</span>
            <div>
              <p className="font-extrabold text-ink">Clover</p>
              <p className="text-[13px] text-ink-3">TAKATAK Food Hub</p>
            </div>
          </div>
          <p className="mt-5 text-[15px] text-ink-2">
            {w.otherPos}{' '}
            <a href={otherPosHref} className="font-bold text-brand underline underline-offset-2">{w.otherPosCta}</a>
          </p>
        </div>
      </div>
    </section>
  );
}

function FactsBand({ lang }: { lang: Lang }) {
  const w = SHOWCASE[lang];
  return (
    <div className="py-4">
      <dl className="grid gap-4 rounded-2xl bg-gradient-to-br from-rail via-rail-2 to-rail p-6 text-white sm:grid-cols-2 lg:grid-cols-4 lg:p-8">
        {w.facts.map((f) => (
          <div key={f.big} className={`${styles.fact} flex flex-col-reverse gap-1 pb-2`}>
            <dt className="text-[14px] text-silver">{f.small}</dt>
            <dd className="bg-gradient-to-r from-white to-cyan bg-clip-text text-2xl font-extrabold tracking-tight text-transparent">{f.big}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Everything between the hero and the landing's text blocks. */
export function LandingShowcase({ lang, ctx }: { lang: Lang; ctx: HubContext }) {
  return (
    <>
      <BrainSection lang={lang} />
      <div className="mx-auto max-w-6xl px-4">
        <ShowcaseCards lang={lang} />
        <FactsBand lang={lang} />
        <FeatureExplorer lang={lang} />
        <IntegrationsPanel lang={lang} ctx={ctx} />
      </div>
    </>
  );
}
