// Finance A–Z report: reads every export dropped in private/finance/inbox/ (Uber Eats, DoorDash, Skip, Clover, bank),
// builds private/finance/FINANCE_A_TO_Z.xlsx and refreshes the "Numbers" block of private/finance/FINANCE_A_TO_Z.md.
// Nothing leaves the machine; everything it writes is under the git-ignored private/ folder.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./scripts/finance/register.mjs scripts/finance-report.ts
//        [--dir private/finance] [--inbox <folder>]… [--as-of YYYY-MM-DD]
//
// Owner files read from --dir (all optional): store-map.csv (store → brand/location), known.json (holds, to-dos,
// company facts from the ops notes), rules.json (overrides of the Rules tab by id).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dedupe, disputeRows, finalize, heldFromData, matchBank, payoutRecords, type HeldRow, type Params } from '../lib/foodhub/finance/analysis';
import { DEFAULT_RULES, EXPORTS_CHECKLIST } from '../lib/foodhub/finance/defaults';
import { parseFinanceFile, type ParsedFile } from '../lib/foodhub/finance/formats';
import { PLATFORM_LABEL, r2, type FinanceLine, type Platform } from '../lib/foodhub/finance/model';
import { parseStoreMap, StoreResolver, type StoreEntry } from '../lib/foodhub/finance/stores';
import { buildFinanceWorkbook, type OwnerEdits, type RuleRow, type TodoRow, type UnreadableFile } from '../lib/foodhub/finance/workbook';
import { readXlsxSheet } from '../lib/foodhub/finance/xlsx';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const DIR = path.resolve(ROOT, opt('dir') ?? 'private/finance');
const AS_OF = opt('as-of') ?? new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
const XLSX_PATH = path.join(DIR, 'FINANCE_A_TO_Z.xlsx');
const MD_PATH = path.join(DIR, 'FINANCE_A_TO_Z.md');

if (!/[\\/]private[\\/]/.test(`${DIR}${path.sep}`)) throw new Error(`Refusing to write financial output outside a private/ folder: ${DIR}`);

// ---------------------------------------------------------------- inputs

/** The main checkout when this runs inside a git worktree (the owner's private/ folder lives there). Read only. */
function mainCheckout(): string | null {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: ROOT, encoding: 'utf8' }).trim();
    const main = path.dirname(common);
    return path.resolve(main) !== path.resolve(ROOT) ? main : null;
  } catch { return null; }
}
const MAIN = mainCheckout();

function inboxDirs(): string[] {
  const dirs = args.flatMap((a, i) => (a === '--inbox' ? [path.resolve(ROOT, args[i + 1])] : []));
  dirs.push(path.join(DIR, 'inbox'));
  if (MAIN) dirs.push(path.join(MAIN, 'private', 'finance', 'inbox'));
  return [...new Set(dirs)].filter((d) => existsSync(d));
}

/** Portal scans by other Food Hub sessions: private/uber/*.csv and private/doordash/*.csv (here and in the main checkout). */
function scanDirs(): string[] {
  if (args.includes('--no-scans')) return [];
  const roots = [ROOT, ...(MAIN ? [MAIN] : [])];
  return [...new Set(roots.flatMap((r) => [path.join(r, 'private', 'uber'), path.join(r, 'private', 'doordash')]))].filter((d) => existsSync(d));
}

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    if (n.startsWith('.') || n.startsWith('~$')) return [];
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? listFiles(p) : [p];
  });
}

const readJson = <T>(p: string, fallback: T): T => { try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, '')) as T : fallback; } catch (e) { throw new Error(`${p}: ${(e as Error).message}`); } };

interface Known {
  company?: string;
  held?: Array<Omit<HeldRow, 'amount'> & { amount?: number | null }>;
  todos?: TodoRow[];
}

function ownerEdits(): OwnerEdits {
  const edits: OwnerEdits = {};
  if (!existsSync(XLSX_PATH)) return edits;
  const bytes = new Uint8Array(readFileSync(XLSX_PATH));
  for (const sheet of ['Disputes', 'Money_Held', 'To_Do', 'Payouts_vs_Bank', 'Exports']) {
    const rows = readXlsxSheet(bytes, sheet);
    const head = rows[3] ?? [];
    const m = new Map<string, Record<string, string>>();
    for (const r of rows.slice(4)) {
      const key = String(r?.[0] ?? '').trim();
      if (!key) continue;
      m.set(key, Object.fromEntries(head.map((h, i) => [h, String(r[i] ?? '').trim()])));
    }
    edits[sheet] = m;
  }
  return edits;
}

// ---------------------------------------------------------------- run

const known = readJson<Known>(path.join(DIR, 'known.json'), {});
const ruleOverrides = readJson<Record<string, number | string>>(path.join(DIR, 'rules.json'), {});
const rules: RuleRow[] = DEFAULT_RULES.map((r) => (r.id in ruleOverrides ? { ...r, value: ruleOverrides[r.id], source: `${r.source} — overridden in rules.json`, confidence: 'OWNER' } : r));
const rule = (id: string) => Number(rules.find((r) => r.id === id)?.value ?? 0);

const files: ParsedFile[] = []; const unreadable: UnreadableFile[] = [];
const inboxes = inboxDirs();
const scans = scanDirs();
for (const dir of scans) {
  for (const p of listFiles(dir).filter((f) => /\.csv$/i.test(f))) {
    const name = path.join(path.basename(dir), path.relative(dir, p));
    try { files.push(parseFinanceFile(name, new Uint8Array(readFileSync(p)))); } catch (e) { unreadable.push({ file: name, reason: (e as Error).message }); }
  }
}
for (const dir of inboxes) {
  for (const p of listFiles(dir)) {
    const name = path.relative(dir, p);
    if (!/\.(csv|tsv|txt|xlsx)$/i.test(p)) { unreadable.push({ file: name, reason: /\.pdf$/i.test(p) ? 'PDF — kept for the accountant; download the CSV version for the analysis' : 'Not a CSV / XLSX file' }); continue; }
    try { files.push(parseFinanceFile(name, new Uint8Array(readFileSync(p)))); } catch (e) { unreadable.push({ file: name, reason: (e as Error).message }); }
  }
}

const brands = readJson<string[]>(path.join(ROOT, 'data/actual/brands.json'), []);
const locations = readJson<Array<{ code: string; address_line_1: string }>>(path.join(ROOT, 'data/actual/locations.json'), []);
// 5839 Jean-Talon E is the same kitchen as 5837 (Saint-Léonard).
const finLocations = [...locations, { code: 'SAINT_LEONARD', address_line_1: '5839 Rue Jean-Talon E' }];
const stores: StoreEntry[] = existsSync(path.join(DIR, 'store-map.csv')) ? parseStoreMap(readFileSync(path.join(DIR, 'store-map.csv'), 'utf8')) : [];
const resolver = new StoreResolver(stores, brands, finLocations);

const { kept: rawLines, duplicates } = dedupe(files.flatMap((f) => f.lines));
const { kept: bank, duplicates: bankDup } = dedupe(files.flatMap((f) => f.bank));
resolver.apply(rawLines);
const lines: FinanceLine[] = finalize(rawLines);

const params: Params = {
  unpaidAfterDays: rule('unpaid_after_days'), bankWindow: [-rule('bank_window_before'), rule('bank_window_after')], tolerance: rule('match_tolerance'),
  disputeDays: { uber_eats: rule('dispute_uber_eats'), doordash: rule('dispute_doordash'), skip: rule('dispute_skip'), clover: rule('dispute_clover'), tgtg: 0 },
  asOf: AS_OF,
};
const payouts = payoutRecords(lines);
const { unmatchedBank } = matchBank(payouts, bank, params);
const disputes = disputeRows(lines, params);
const held: HeldRow[] = [...(known.held ?? []).map((h) => ({ ...h, amount: h.amount ?? null })), ...heldFromData(lines, payouts, params)];

// To-do: the owner's list + what the data shows.
const todos: TodoRow[] = [...(known.todos ?? [])];
const ids = new Set(todos.map((t) => t.id));
const addTodo = (t: TodoRow) => { if (!ids.has(t.id)) { ids.add(t.id); todos.push(t); } };
for (const p of Object.keys(PLATFORM_LABEL) as Platform[]) {
  const open = disputes.filter((d) => d.platform === p && d.daysLeft !== null && d.daysLeft >= 0 && d.amount < 0);
  if (open.length) addTodo({ id: `AUTO-DISPUTE-${p}`, priority: 'P1', area: 'Dispute', task: `${open.length} ${PLATFORM_LABEL[p]} charge(s) can still be disputed (first deadline ${open[0].deadline}) — review each in the Disputes tab`, platform: PLATFORM_LABEL[p], amount: r2(open.reduce((a, d) => a + d.amount, 0)), due: open[0].deadline, who: 'Owner', status: 'Open', notes: '' });
}
for (const h of heldFromData(lines, payouts, params)) addTodo({ id: `AUTO-${h.id}`.slice(0, 60), priority: 'P1', area: 'Hold', task: `${h.what} — ${h.action}`, platform: h.platform, amount: h.amount, due: null, who: 'Owner', status: 'Open', notes: '' });
const missing = EXPORTS_CHECKLIST.filter((e) => e.formats.length && !e.formats.some((f) => files.some((x) => x.format === f)));
if (missing.length) addTodo({ id: 'AUTO-EXPORTS', priority: 'P1', area: 'Data', task: `Download the missing exports: ${missing.map((e) => `${e.id} ${e.platform} ${e.report.split(' — ')[0]}`).join('; ')} (see Exports tab)`, platform: 'All', amount: null, due: null, who: 'Owner', status: 'Open', notes: '' });
if (resolver.unknown.size) addTodo({ id: 'AUTO-STORES', priority: 'P3', area: 'Data', task: `${resolver.unknown.size} store(s) in the exports are not in store-map.csv (brand/location guessed from the name) — see bottom of Stores tab`, platform: 'All', amount: null, due: null, who: 'Claude / owner', status: 'Open', notes: '' });
const unexplained = r2(lines.filter((l) => l.inPnl).reduce((a, l) => a + l.unexplained, 0));
if (Math.abs(unexplained) >= 1) addTodo({ id: 'AUTO-UNEXPLAINED', priority: 'P2', area: 'Data', task: `Statement lines leave ${unexplained.toFixed(2)} $ not broken down (a statement column is not mapped) — see Files tab warnings`, platform: 'All', amount: unexplained, due: null, who: 'Claude', status: 'Open', notes: '' });

const { bytes, expected } = buildFinanceWorkbook({
  asOf: AS_OF, company: known.company ?? 'Quadro Holdings LTEE', lines, bank, payouts, unmatchedBank, disputes, held, todos, rules, stores, files, unreadable,
  exportsChecklist: EXPORTS_CHECKLIST, unknownStores: [...resolver.unknown.values()], edits: ownerEdits(), duplicates: duplicates + bankDup,
});

mkdirSync(path.join(DIR, 'work'), { recursive: true });
let out = XLSX_PATH;
try { writeFileSync(out, bytes); } catch (e) {
  if ((e as NodeJS.ErrnoException).code !== 'EBUSY' && (e as NodeJS.ErrnoException).code !== 'EPERM') throw e;
  out = path.join(DIR, `FINANCE_A_TO_Z (new ${AS_OF}).xlsx`); writeFileSync(out, bytes);
  console.warn(`The workbook is open in Excel — wrote ${path.basename(out)} instead. Close Excel and run again to replace it.`);
}
writeFileSync(path.join(DIR, 'work', 'expected-values.json'), JSON.stringify(expected));
writeFileSync(path.join(DIR, 'work', 'lines.json'), JSON.stringify({ asOf: AS_OF, lines, bank, payouts, disputes, held }, null, 1));

// ---------------------------------------------------------------- numbers block in the markdown

const money = (n: number) => `${n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
const pct = (n: number) => `${(n * 100).toFixed(1)} %`;
const pnl = lines.filter((l) => l.inPnl);
const sum = (ls: FinanceLine[], f: keyof FinanceLine) => r2(ls.reduce((a, l) => a + (Number(l[f]) || 0), 0));
const md: string[] = [];
md.push(`*Generated ${AS_OF} by \`scripts/finance-report.ts\` — files read: ${files.length}, unreadable: ${unreadable.length}, P&L lines: ${pnl.length}, bank lines: ${bank.length}, duplicates removed: ${duplicates + bankDup}.*`, '');
if (!pnl.length) md.push('**No platform export has been loaded yet** — every figure below waits for the exports in §0.', '');
else {
  md.push('| Platform | Months | Orders | Item sales | Commission | Commission % | Marketing | Error charges + refunds | All-in cost % | Net payout | Net revenue ex-tax | Net / order |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const p of Object.keys(PLATFORM_LABEL) as Platform[]) {
    const ls = pnl.filter((l) => l.platform === p); if (!ls.length) continue;
    const ms = [...new Set(ls.map((l) => l.month))].sort();
    const sales = sum(ls, 'itemSales'); const orders = sum(ls, 'orderCount');
    const cost = -(sum(ls, 'promotions') + sum(ls, 'commission') + sum(ls, 'marketing') + sum(ls, 'fees') + sum(ls, 'errorCharges') + sum(ls, 'refunds'));
    const netRev = sales + sum(ls, 'promotions') + sum(ls, 'commission') + sum(ls, 'marketing') + sum(ls, 'fees') + sum(ls, 'errorCharges') + sum(ls, 'refunds') + sum(ls, 'adjustments') + sum(ls, 'other');
    md.push(`| ${PLATFORM_LABEL[p]} | ${ms[0]} → ${ms[ms.length - 1]} | ${orders || 'n/a'} | ${money(sales)} | ${money(sum(ls, 'commission'))} | ${sales ? pct(-sum(ls, 'commission') / sales) : '—'} | ${money(sum(ls, 'marketing'))} | ${money(sum(ls, 'errorCharges') + sum(ls, 'refunds'))} | ${sales ? pct(cost / sales) : '—'} | ${money(sum(ls, 'net'))} | ${money(netRev)} | ${orders ? money(netRev / orders) : '—'} |`);
  }
  md.push('', '**Same period, per year** (portal-scan months are statement totals: tax estimated, DoorDash "services" = commission + marketing + tablet):', '',
    '| Platform | Year | Months | Item sales (pre-tax) | Commission | Marketing | Fees / adjustments / other | Net payout | Net revenue ex-tax | Kept of item sales |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const p of Object.keys(PLATFORM_LABEL) as Platform[]) {
    for (const y of [...new Set(pnl.filter((l) => l.platform === p && l.month).map((l) => l.month.slice(0, 4)))].sort()) {
      const ls = pnl.filter((l) => l.platform === p && l.month.startsWith(y));
      const sales = sum(ls, 'itemSales');
      const rest = sum(ls, 'fees') + sum(ls, 'errorCharges') + sum(ls, 'refunds') + sum(ls, 'adjustments') + sum(ls, 'other');
      const netRev = sales + sum(ls, 'promotions') + sum(ls, 'commission') + sum(ls, 'marketing') + rest;
      md.push(`| ${PLATFORM_LABEL[p]} | ${y} | ${new Set(ls.map((l) => l.month)).size} | ${money(sales)} | ${money(sum(ls, 'commission'))} | ${money(sum(ls, 'marketing'))} | ${money(rest)} | ${money(sum(ls, 'net'))} | ${money(netRev)} | ${sales ? pct(netRev / sales) : '—'} |`);
    }
  }
  md.push('');
}
const heldKnown = held.filter((h) => h.amount !== null);
md.push(`**Money held / not received:** ${held.length} item(s); known amount ${money(r2(heldKnown.reduce((a, h) => a + (h.amount ?? 0), 0)))}; ${held.length - heldKnown.length} with amount still unknown (see workbook Money_Held).`);
md.push(`**Disputes register:** ${disputes.length} line(s); still disputable today: ${disputes.filter((d) => d.daysLeft !== null && d.daysLeft >= 0 && d.amount < 0).length}.`);
md.push(`**Payouts vs bank:** ${payouts.length} payout(s); matched ${payouts.filter((p) => p.match === 'matched').length}; not found in bank ${payouts.filter((p) => p.match === 'not_in_bank').length}; failed/held ${payouts.filter((p) => p.match === 'failed').length}; unpaid ${payouts.filter((p) => p.match === 'unpaid').length}; bank period not loaded ${payouts.filter((p) => p.match === 'bank_not_loaded').length}.`);
const partly = EXPORTS_CHECKLIST.filter((e) => (e.partial ?? []).some((f) => files.some((x) => x.format === f)));
md.push(`**Exports received:** ${EXPORTS_CHECKLIST.filter((e) => e.formats.length && e.formats.some((f) => files.some((x) => x.format === f))).map((e) => e.id).join(', ') || 'none'} · **missing:** ${missing.map((e) => e.id).join(', ') || 'none'}${partly.length ? ` (partly covered by the portal scans: ${partly.map((e) => e.id).join(', ')})` : ''}.`);
if (files.some((f) => f.warnings.length) || unreadable.length) {
  md.push('', '**File notes:**');
  for (const f of files) for (const w of f.warnings.slice(0, 3)) md.push(`- ${f.file}: ${w}`);
  for (const u of unreadable) md.push(`- ${u.file}: ${u.reason}`);
}
const START = '<!-- AUTO:NUMBERS:START -->'; const END = '<!-- AUTO:NUMBERS:END -->';
if (existsSync(MD_PATH)) {
  const doc = readFileSync(MD_PATH, 'utf8');
  const a = doc.indexOf(START); const b = doc.indexOf(END);
  if (a >= 0 && b > a) writeFileSync(MD_PATH, `${doc.slice(0, a + START.length)}\n${md.join('\n')}\n${doc.slice(b)}`);
}

console.log(`Inbox folders: ${inboxes.join(' | ') || '(none)'}`);
console.log(`Portal-scan folders: ${scans.join(' | ') || '(none)'}`);
console.log(`Files: ${files.length} read, ${unreadable.length} unreadable · lines ${lines.length} (P&L ${pnl.length}) · bank ${bank.length} · duplicates removed ${duplicates + bankDup}`);
for (const f of files) console.log(`  ${f.file} → ${f.format}${f.platform ? ` (${f.platform})` : ''}: ${f.lines.length + f.bank.length} lines, ${f.skipped} skipped${f.warnings.length ? ` · ${f.warnings[0]}` : ''}`);
for (const u of unreadable) console.log(`  ${u.file} → not read: ${u.reason}`);
console.log(`Payouts ${payouts.length} · disputes ${disputes.length} · held ${held.length} · to-do ${todos.length} · formulas with expected values ${Object.keys(expected).length}`);
console.log(`Workbook: ${out}`);
