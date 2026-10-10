# Finance A–Z report (offline, private data only)

`scripts/finance-report.ts` builds a complete financial analysis from the platforms' own exports. It covers
Uber Eats, DoorDash, SkipTheDishes, Clover and the bank statements.

**Privacy.** It writes only into the git-ignored `private/finance/` folder and refuses to write anywhere else.
This repository is public: no financial file, export or number is ever committed.

## What it produces

| File | What |
|---|---|
| `private/finance/FINANCE_A_TO_Z.xlsx` | The workbook (tabs listed below) |
| `private/finance/FINANCE_A_TO_Z.md` | The report. The script rewrites only the block between `<!-- AUTO:NUMBERS:START -->` and `<!-- AUTO:NUMBERS:END -->` |
| `private/finance/work/lines.json` | Every normalized line, for audit |
| `private/finance/work/expected-values.json` | The value of every formula, for the Excel check |

Workbook tabs:

| Tab | Content |
|---|---|
| README, Exports | How to read the workbook; which exports are received or still waiting |
| PnL_Monthly, PnL_Brand_Location | P&L per platform × month, and per platform × brand × location × month |
| Commission_Compare | Effective commission %, all-in platform cost %, net per order, cancellations; per platform, mode, kitchen, brand and year |
| Tax_Summary | GST / QST collected, GST / QST paid on platform fees (ITC / ITR, estimated), the stray Clover "Sales Tax", sales the platform taxed QST only (no GST charged) and the GST still owed on them |
| Disputes | Error charges, refunds, adjustments and cancellations, with the deadline from the Rules tab |
| Payouts_vs_Bank, Money_Held, To_Do | Bank matching, money held and to-do list. The owner types in the yellow cells, which are kept on rebuild. |
| Rules, Stores, Lines, Bank, Files | Parameters with sources, the store map, the raw data, and what was read |

Every total is a live `SUMIFS` over the `Lines` tab. Each formula is written with the value the script computed as
its cached result.

## Inputs (all optional, all private)

| Path | Content |
|---|---|
| `private/finance/inbox/` (+ the main checkout's when run from a worktree) | Exports as CSV / XLSX. Detected from their headers: Uber "Payment Details", DoorDash financial "Transactions" and "Payouts" (portal CSV or Reporting API), Skip reports, Clover payments / orders / deposits, bank CSVs. PDFs are listed, not read. |
| `private/uber/*.csv`, `private/doordash/*.csv` | Portal scans written by other sessions (monthly statement totals). They are used for a platform-month only while no per-order export covers it. |
| `private/finance/store-map.csv` | Platform store → brand → location (`platform,store_id,store_name,brand,location_code,address,bank_last4,status,note`) |
| `private/finance/known.json` | Holds, claims and to-dos from the ops notes |
| `private/finance/rules.json` | Overrides of the Rules tab by id, e.g. `{ "dispute_skip": 14 }` |

## Run

Works with or without `npm ci`: Node ≥ 22.18 strips the types. `scripts/finance/register.mjs` resolves the repo's
imports and supplies stand-ins for `fflate` / `vitest` when `node_modules` is absent.

```
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./scripts/finance/register.mjs scripts/finance-report.ts
powershell -File scripts/finance/verify-xlsx.ps1 -Path private/finance/FINANCE_A_TO_Z.xlsx -Expected private/finance/work/expected-values.json
```

The second command opens the workbook in Excel (hidden, read-only) and recalculates it. It reports any formula that
evaluates to an error or that differs from the computed value.

Options:

| Option | Effect |
|---|---|
| `--dir <private folder>` | Use another private folder |
| `--inbox <folder>` (repeatable) | Read exports from another folder too |
| `--as-of YYYY-MM-DD` | Date used for "days left" |
| `--no-scans` | Ignore the portal scans |

## Rules the numbers follow

**Signs.** Money in is +; money the platform keeps is −. Net payout = sum of the components. Anything a statement
does not break down shows as *Unexplained*.

**No double counting.** These are never added twice:

| Case | How |
|---|---|
| Same row in overlapping exports | Stable key per row |
| Platform orders recorded in Clover with a platform tender | Not counted as Clover sales |
| Payout summaries and portal-scan statement totals | Used only for months with no per-order export |
| Itemized portal-scan lines (error charges, tablet fees) | Listed in the registers, not in the P&L |

**Tax.**
- GST and QST are kept apart. Split GST / QST columns win over a combined "Tax on …" column for the same base.
- Tax-included totals are split 5 : 9.975 and flagged as estimated. The federal GST holiday (2024-12-14 → 2025-02-15) is taken into account.
- The fee sign and the day / month order are detected per file.

## Tests

`tests/finance.test.ts`: `npm test`, or without `node_modules`:
`node --import ./scripts/finance/register.mjs tests/finance.test.ts`.
