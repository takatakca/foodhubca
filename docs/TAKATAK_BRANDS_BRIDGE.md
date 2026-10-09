# TAKATAK brands bridge: the takatak.ca brand section and Food Hub's brand data

Decision note for task 20 (see `docs/PROGRESS.md`). Written 2026-10-09 on branch `claude/google-doordash-id-extraction-wg2f5l`.
Public repository: this note has no emails, phone numbers, case numbers, secrets or merchant ids.

## 1. Pour le propriétaire

- La section « Nos marques » de takatak.ca est vide exprès. Une marque n'y apparaît que si le registre knowledgeAI dit qu'elle appartient à GROUPE TAKATAK et qu'elle est active. Pour l'instant, aucune marque n'y est inscrite comme ça.
- Notre choix : on ne copie pas le code de Food Hub. takatak.ca **lit** le flux public de Food Hub, qui est déjà sur `main`, et garde une copie de secours. Les heures et les liens se règlent à un seul endroit.
- Les espaces TAKATAK V1 (un par marque, Quadro Holding administrateur de tous, accès des marques par invitation) passent par le script déjà commencé. Il tourne d'abord en mode essai, puis vous approuvez.
- Il nous manque vos réponses (section 6). Trois sont urgentes : (1) les restaurants de Quadro Holding peuvent-ils être affichés sur takatak.ca, et sous quel titre ? (2) Quelles sont les vraies heures de chaque cuisine : 16 h à 3 h tous les jours ? (3) Quelle est l'adresse officielle du flux Food Hub ?

## 2. The problem

takatak.ca has an "Our brands" page (`/ecosystem`). It shows nothing, and the footer and homepage links to it are hidden. The page is not broken. A rule keeps it empty on purpose.

- The rule is in `takatak-v1/src/lib/website/owned-brands.ts`: list a brand only when the knowledgeAI registry marks it **owned by GROUPE TAKATAK and active**. Never list a client's brand.
- The registry (`knowledgeAI/registry/portfolio-registry-2026-10-06.json`) has no ownership field. Every asset is `UNKNOWN_NEEDS_AUDIT`. So no brand qualifies, `ownedBrands` is `[]` and `hasOwnedBrands` is `false`.
- The 17 restaurant brands belong to Quadro Holding. Food Hub names the legal company Quadro Holdings LTEE (`docs/LOCKED_DECISIONS.md`, `lib/foodhub/legal.ts`). knowledgeAI calls them the "Restaurant / Food Client Network" (`projects/RESTAURANT-NETWORK.md`). Neither source says GROUPE TAKATAK.
- The page intro says "GROUPE TAKATAK proudly owns and operates these brands". Putting Quadro Holding's restaurants under that sentence would be a false public claim unless the owner records otherwise.

**No code change alone can fill this page. The owner must decide first (section 6, decision 1).** The code below only gets the data ready, so the page fills the day the decision is written down.

## 3. What already exists

### Data path

```
pppmtl  src/config/brands.ts            (brand source: names, kitchens, store links)
   │  read by
   ▼
foodhubca  scripts/public-directory/build-seed.mts
   ▼
foodhubca  data/public/directory-seed.json   (17 brands, 2 kitchens, 151 dishes)
   ▼
foodhubca  lib/foodhub/public-directory.ts  buildPublicDirectory()
           live hours (Settings → Hours) and live menu win over the seed
   ▼
GET /api/public/directory  (version 1, public, 5-minute cache)
   ▼
on2goca  scripts/fetch-directory.mjs → data/directory.json → on2go.ca/restaurants/<slug>
```

### Pieces and their merge status (checked 2026-10-09)

| Piece | Repo, branch | Paths | Status |
|---|---|---|---|
| Brand source | pppmtl `feature/multi-brand` (last commit 9d61117) | `src/config/brands.ts`, `src/lib/brand/__tests__/brands.test.ts`, `docs/brands.md` | **Not merged.** Lovable-connected. |
| Public feed | foodhubca `main` | `lib/foodhub/public-directory.ts`, `app/api/public/directory/route.ts`, `tests/public-directory.test.ts`, `data/public/directory-seed.json`, `scripts/public-directory/build-seed.mts`, `docs/PUBLIC_DIRECTORY_API.md` | **Merged** (PR #16, merge 9da0ba6). Deployment to be confirmed by the owner (manual Coolify deploy). |
| Store switcher | foodhubca `feature/console-store-switcher` | `lib/foodhub/scope.ts` | Not merged. Used by the Food Hub console only. takatak.ca does not need it, because V1 already has its own brand switcher. |
| Ecosystem contracts | foodhubca `docs/on2go-hub-ecosystem` | `docs/ON2GO_HUB_ECOSYSTEM.md` §2.1 (C1 = public feed), §4.3 (TAKATAK owns the client account; Food Hub owns orders, menus, stores) | Docs branch. |
| ON2GO consumer | on2goca `feature/on2go-directory` | `lib/directory.ts`, `scripts/fetch-directory.mjs`, `data/directory.json`, `.github/workflows/site.yml` | **Not merged.** Already reads the feed. |
| takatak.ca brand page | takatak-v1 `main` | `src/lib/website/owned-brands.ts`, `src/app/(website)/ecosystem/page.tsx`, `src/components/website/pages/owned-brands-content.tsx`, `src/components/website/home/HomeEcosystemGrid.tsx`, `src/components/website/layout/SiteFooter.tsx` | On main. The list is empty, so the page stays hidden. |
| Workspace provisioning | takatak-v1 `claude/provision-brand-workspaces` (local only; commit 312ae5e is just the WORKLOG claim; not pushed) | Untracked: `src/lib/provisioning/workspace-provisioning-policy.ts` (1489 lines), `src/lib/provisioning/workspace-provisioning-runner.ts` (760 lines). The entry script `scripts/provision-workspaces.ts` is not written yet. | Work in progress. It is a dry-run planner that uses the app's own validators and plan gates. |
| Full Food Hub port | takatak-v1 PR #27 `feature/food-hub` (8f11e83, 1302 files, no merge base with main) | | **Frozen** (`docs/DEV-TODO.md`). |

**Correction to the planning brief:** the brief said `feature/public-directory-api` was not merged. It is: PR #16 is on `main`. Proposal C and both reviewers found this, and it was checked again here. On the Food Hub side, nothing needs merging. The owner only needs to confirm that `main` is deployed.

### Facts about the feed today

- It is public under `/api/public/` and sends `Cache-Control: public, max-age=300`. Food Hub keeps its own 5-minute server cache.
- It never links Po Poulet NDG on DoorDash, and its tests check every link for that.
- Hours in the seed: NDG 16:30–03:15, Saint-Léonard 09:00–23:00, every day. Source: Uber Eats Manager, read 2026-10-07. These differ from the owner's 16:00–03:00. See section 6.
- The feed never says "24/7".
- Feed host: ON2GO's workflow uses `foodhub.on2go.ca`, while other docs say `foodhub.takatak.ca`. One of them must be confirmed.

## 4. The decision

### Winner: Approach A, "read the feed"

Three approaches were studied and scored by two reviewers, out of 50:

| Approach | Reviewer 1 | Reviewer 2 |
|---|---|---|
| **A. Read the feed** (takatak-v1 reads Food Hub's public feed on the server) | **38** | **37** |
| B. Port the code (copy the seed and the builder into takatak-v1) | 19 | 18 |
| C. One shared registry (new repo copied into pppmtl, Food Hub and V1) | 25 | 23 |

Both reviewers picked A.

In short:

- takatak-v1 gets one small module that reads `GET /api/public/directory` on the server. It caches the result for 5 minutes. If the feed fails, it uses a committed snapshot made by Food Hub's own `buildPublicDirectory()`.
- The `/ecosystem` page keeps its ownership gate. The feed supplies display facts only: description, whether the website is live, kitchen area and hours. Whether a brand is listed still depends only on owner-confirmed ownership.
- The dashboard side, one V1 workspace per brand, reuses the provisioning planner already in progress. A small adapter turns approved feed brand ids into that planner's input.
- Workspaces, memberships, plans and invitations stay in V1. Food Hub never calls V1.

### Why we did not copy the code (for the developer)

The owner asked to "swipe the code from Food Hub and paste it". We studied that seriously (Approach B). We chose not to, for concrete reasons:

1. **It would not run as is.** `lib/foodhub/public-directory.ts` imports `getRepo` (Food Hub's database) and uses Node's `Buffer`. `lib/foodhub/hours.ts` imports `getRepo`, `nowIso` and `time`. pppmtl's `brands.ts` uses Vite's `import.meta.env` and carries a group phone and Google ids. Each would have to be cut apart before it could compile in takatak-v1.
2. **A copy goes stale without anyone noticing.** If hours or an order link change in Food Hub, takatak.ca keeps the old values until someone copies again.
3. **It adds copies.** The copied JSON would be a 4th copy of the brand data. Inside V1 it would also give two unlinked brand sources: the static copy and the `BusinessBrand` rows.
4. **It was already tried.** PR #27 ported all of Food Hub into V1. It is frozen.
5. **The house rules ask to reuse.** knowledgeAI `docs/06-AGENT-OPERATING-RULES.md` (discover → reuse → standardize → approve → build) says not to duplicate existing systems silently.

The feed is the part of Food Hub built for partners like takatak.ca. Reading it **is** reusing Food Hub's multi-brand setup, through the door that was built for it. This is the same pattern ON2GO already uses.

### Why not Approach C

A shared registry would fix brand-list drift. But it needs a new repo and changes in 4 repos, including the Lovable-connected pppmtl. It would create a second brand master next to V1 and still show nothing on takatak.ca. It could be revisited after the ownership decision if brand lists keep drifting.

### What A costs (said plainly)

- A third copy of the feed types and safety checks (Food Hub, ON2GO, takatak-v1). This is limited by declaring only the fields V1 reads, with the same names.
- A second committed snapshot (ON2GO has one, takatak-v1 adds one).
- V1 brand rows are first filled from the feed. That needs the field-ownership table below, so there are never two masters for one field.
- A server-side pull is not one of the four patterns in knowledgeAI `eim:docs/10-ECOSYSTEM-INTEGRATION-MAP.md` §6. It must be written down there (step K1).

### Ideas taken from the other proposals

- **From C:** the corrected merge status (feed on `main`). The existing provisioning claim is continued, not duplicated. Ownership becomes data: dated `ownerConfirmedBy` and `ownerConfirmedOn` fields. Feed and V1 are joined on the directory slug.
- **From C, later:** a Food Hub test that every seed `foodhubBrandNames` entry exists in `data/actual/brands.json`. That file has drift today: "Too Good To Go" is listed as a brand, BMBD appears twice, and Pizza Algérie is missing.
- **From B:** Food Hub's seed-test rules ported into a V1 check script that runs in CI. V1's types stay a strict subset of the feed's shape, so a later shared package is a swap, not a rewrite. Later, if a public section is approved: Restaurant JSON-LD per kitchen, without phone or Google id.

### Field ownership (who is master of what)

| Field | Master | In V1 |
|---|---|---|
| Brand name (until the owner rules on spelling), website domain, category, city/region/country, kitchen address, map point | Food Hub feed (origin: pppmtl) | Written at creation. Updated later **only if the V1 value still equals the last synced value**. Otherwise the run reports a conflict. Nothing is ever deleted. |
| Workspace name after creation, brand status, logo/image, social accounts, Google listings, AI instructions, legal name, memberships, invitations, plan and billing | TAKATAK V1 | Never touched by the sync. |
| Hours, open now, open late, dishes, prices, order links, trending | Food Hub (live) | Not stored, because V1 has no hours field. The planner already reports hours as "UNSUPPORTED". Shown read-only from the cached feed. |

### Where the proposals and reviewers disagree

| Point | Views | What this note decides |
|---|---|---|
| Feed merge status | Brief and A, B: not merged. C and both reviewers: merged. | Merged (PR #16, 9da0ba6). Checked. |
| Workspace script | A: a new `provision-plan.ts` and `sync-foodhub-brands.ts`. Both reviewers: reuse the existing claimed planner. | Reuse it. Add only a small adapter. |
| Join key between feed and V1 | A: domain. Reviewer 2: directory slug, because several brands share a domain or have none. | Slug (`foodhubBrandId`, for example `ppp-pizzeria`). The display name follows the registry until the owner decides. |
| External-id link in V1 | A: `ManagedContentItem` (no migration). Reviewer 1: long term `MasterMerchant`/`SourceMerchant`. Reviewer 2: `ManagedContentItem` with the developer's OK, or a nullable `BusinessBrand` external id (migration). | The developer decides (step T9). `ManagedContentItem` is a stopgap only, because it is today the community-content table. |
| Integration standard | A: an exception or a new pattern 5. Reviewer 2: a variant of pattern 2 (fixed path, strict validation, fail closed, off by default). | Record it as a pattern 2 variant for a public feed with no credential. If the developer prefers, record it as an exception. |
| Where the decision lives | Reviewer 1: one record in takatak-v1, linked from here. Reviewer 2: write it here and mirror it in takatak-v1. | **This file is the decision record.** takatak-v1 `docs/FOODHUB_DIRECTORY_INTEGRATION.md` is a short how-to that links here. It does not copy the decision. |
| Hours on takatak.ca | Reviewer 1: hidden, or labelled with the source date, until confirmed. Reviewer 2: generated from the feed. | Hidden until the owner confirms hours in Food Hub. After that, generated from the feed, never typed. |

## 5. Step-by-step plan

Each step is one small pull request or one owner action, with a check. Do them in this order.

### Food Hub (foodhubca)

- **F1. This note.** Docs only, on `claude/google-doordash-id-extraction-wg2f5l`. Update the task 20 row in `docs/PROGRESS.md` and the line in `WORKLOG.md`.
- **F2. Owner: deploy `main`** from Coolify. It already contains PR #16. Check: `GET https://<confirmed host>/api/public/directory` returns `"version": 1`, 17 brands and `max-age=300`. Agents never deploy.
- **F3. Hours at the source**, only after the owner confirms them.
  - The owner sets each kitchen in Food Hub **Settings → Hours**. This wins live and reaches every reader within 5 minutes.
  - Then a small PR: pppmtl `KITCHENS` (after pppmtl merges) → rerun `scripts/public-directory/build-seed.mts` → `data/public/directory-seed.json`. Update `tests/public-directory.test.ts`, which today expects Saint-Léonard 09:00–23:00 to be "not late".
  - Run the full checks: typecheck, lint, test, `rm -rf .next && npx next build --webpack`, `npm run verify:foodhub`.
- **F4. Optional:** add a test that every seed `foodhubBrandNames` entry exists in `data/actual/brands.json`, and fix the drift. Separate PR.
- **F5. Optional, later:** add a `googleCid` field per location to the feed (an addition; version stays 1). Only if the owner wants Google pages linked automatically.
- No CORS change is needed, because takatak.ca reads the feed on its server.

### TAKATAK V1 (takatak-v1)

Read layer: its own branch (for example `feature/foodhub-directory`), under the same task 20 claim. Provisioning: continues on `claude/provision-brand-workspaces`. Checks before each push: `npm run typecheck`, `npm run lint`, the qa scripts, `npm run build`.

- **T1. Save the work in progress.** Commit the untracked `src/lib/provisioning/*.ts` as WIP on `claude/provision-brand-workspaces` and push it. This needs write access. Update the WORKLOG claim line. Check: `git status` is clean.
- **T2. Contract and guards.** `src/lib/integrations/foodhub-directory/contract.ts` declares only the fields V1 reads, with the feed's own names. `parseFoodhubDirectory()` does five things:
  - requires `version === 1`;
  - accepts only slug ids and https URLs;
  - drops any link to the Po Poulet NDG DoorDash store (same number as `FORBIDDEN_STORE_IDS` in Food Hub);
  - rejects "24/7" or "24 h" wording;
  - caps sizes.

  Add `scripts/foodhub-directory-tests.ts` and the `package.json` script `qa:foodhub-directory`. Check: `npm run qa:foodhub-directory`.
- **T3. Snapshot.** Create `src/data/foodhub/directory.snapshot.json` in a Food Hub checkout with `PUBLIC_DIRECTORY_SNAPSHOT=<path> npx vitest run tests/public-directory.test.ts`. Refresh it by PR. Check: the qa script applies the ported Food Hub rules to it:
  - Po Poulet appears only at Saint-Léonard;
  - no forbidden store anywhere;
  - no "24/7" or "24 h";
  - no email or phone number;
  - order URLs only on platform hosts.
- **T4. Fetch.** `src/lib/integrations/foodhub-directory/client.ts`, server only:
  - off by default: `FOODHUB_DIRECTORY_ENABLED=false`, plus `FOODHUB_DIRECTORY_URL`, which must be https;
  - 5 s timeout, 5-minute cache, one shared load for concurrent calls;
  - falls back to the snapshot on any failure;
  - returns `{directory, origin: 'live' | 'snapshot', fetchedAt}`.

  Add the variable names (no values) to `.env.example`. Check: flag off gives the snapshot; a bad URL gives the snapshot. "Connected" shows only when `origin === 'live'`.
- **T5. Ownership gate.** In `src/lib/website/owned-brands.ts`, add `foodhubBrandId`, `ownerConfirmedBy` and `ownerConfirmedOn` next to the mandatory `registryRef`. The list stays empty, and `hasOwnedBrands` stays a build-time constant. Check: a qa test fails on any entry missing `registryRef` or `ownerConfirmedOn`, and `hasOwnedBrands === false` today.
- **T6. Page.** `src/app/(website)/ecosystem/page.tsx` becomes a server component, rebuilt at most every 5 minutes (`revalidate = 300`). It loads the feed only when `hasOwnedBrands` is true, joins on `foodhubBrandId`, and passes plain rows to `owned-brands-content.tsx`. Each card shows:
  - the registry name;
  - the FR/EN description from the feed;
  - a website link only when `website.live` is true;
  - the kitchen area;
  - an hours line, hidden until the owner confirms the hours.

  The cards never use the feed's colours (BRAND.md keeps red and green for status). There are no order buttons, because ordering is ON2GO's job. Check: build passes; with the empty list the page stays hidden and noindex; with a test fixture it renders.
  - **PR 1 = T2 to T6.** It is safe to merge before any ownership decision, because nothing becomes visible.
- **T7. Adapter.** Add `src/lib/integrations/foodhub-directory/to-provisioning-data.ts`, a pure function. It turns an owner-approved list of feed ids (`FOODHUB_SYNC_BRAND_IDS`, never "the whole feed") into the planner's data-file shape: workspace, brand, locations.
  - A hard guard skips Po Poulet at NDG.
  - It contains no emails. Invitations come only from the private file outside git, or the owner types them in `/dashboard/team`.

  Check: unit tests in the qa script.
- **T8. Script.** Write `scripts/provision-workspaces.ts`, the name the runner already uses.
  - It is a dry run by default. `--apply` writes only through the app's services: create client, create brand, location service. It never bypasses `assertClientCanAddBrand`.
  - The Quadro Holding admin Profile must already exist.
  - Check: show the dry-run output to the owner. Run `--apply` only after the owner says yes.
- **T9. External-id link.** The developer chooses one (see the disagreements table):
  - `ManagedContentItem` (`publisherCode 'foodhub'`, key = slug; its migration is already approved);
  - `MasterMerchant`/`SourceMerchant`;
  - a reviewed migration that adds a nullable external id on `BusinessBrand`.

  It is needed for safe re-runs and for the "update only if unchanged" rule.
- **T10. Dashboard card.** `src/app/dashboard/brands/[brandId]/page.tsx` gets a read-only "Food Hub" card: hours per kitchen, website live, origin and last sync. It shows only when a link exists. First ask the owner whether the "#27 Food Hub" freeze in `docs/DEV-TODO.md` covers this card.
- **T11. Docs.** `docs/FOODHUB_DIRECTORY_INTEGRATION.md` holds the environment variables, the snapshot refresh command, the tests and a link to this note. Add one line to `docs/DEV-TODO.md`.

### knowledgeAI

- **K1.** On branch `eim`, in `docs/10-ECOSYSTEM-INTEGRATION-MAP.md`, add the row "Food Hub C1 public feed → V1 (server pull, read-only, public facts)". Record it as a pattern 2 variant, or as an exception if the developer prefers.
- **K2. Owner only.** In the registry, record the owner, status, who confirmed and the date for each brand to be listed. Add the 6 brands that are missing, if wanted.
- **K3.** After decision 1, record the Quadro Holding vs GROUPE TAKATAK answer in `projects/RESTAURANT-NETWORK.md`.

### pppmtl

- **P1.** No change for takatak.ca. `feature/multi-brand` stays the seed's source. The owner merges it. It is Lovable-connected, so no force push and no rebase of pushed commits. If hours change, `KITCHENS` follows the owner's confirmed hours, then Food Hub rebuilds the seed (F3).

### on2goca

- **O1.** No change. ON2GO keeps reading the feed. Make sure its `FOODHUB_DIRECTORY_URL` uses the confirmed host.

## 6. Owner decisions needed

1. **Listing the restaurants on takatak.ca.** Pick one. Until you answer, (c) applies.
   - (a) Record in the registry, brand by brand and dated, that the brand is GROUPE TAKATAK-owned and active.
   - (b) Approve a separate section with different words, for example "Restaurants on our platform" linking to on2go.ca. This changes the "never list a client's brand" rule in writing.
   - (c) Keep the page hidden and only wire the data.
2. **Names.** The feed and the registry spell some brands differently: OOEUF vs O'Œufs Déjeuner, OCRÊPE vs O'Crêpe, Gâteaux Montréal vs Viennoise, Nutrition Shake vs Nutri/Nutrition Shake. Six feed brands are not in the registry at all: Mythos & Go, Pita Libanais, Déjeuner Montréal, Pizza Algérie, Poulet Poulet, Place Afrique. Which spelling wins, and should the missing brands be added?
3. **Workspaces.**
   - One V1 workspace per brand, as you asked: confirm which brands. Déjeuner Montréal and Place Afrique have no order links, and Pizza Algérie has no Food Hub name.
   - Create the Quadro Holding admin account yourself.
   - Choose a plan for each workspace. A new workspace has a locked Social plan, so adding a brand is refused, and the script will not bypass that.
4. **Hours.** You said every day 16:00–03:00. The data says NDG 16:30–03:15 and Saint-Léonard 09:00–23:00. Confirm per kitchen and set them in Food Hub Settings → Hours. They are never fixed in takatak-v1.
5. **Feed host.** `foodhub.on2go.ca` or `foodhub.takatak.ca`?
6. **Deploy.** Confirm that Food Hub `main` (with PR #16) is deployed.
7. **Merge order.**
   1. Food Hub `main`: deploy only.
   2. takatak-v1 PR 1 (read layer; shows nothing).
   3. Decision 1.
   4. The takatak-v1 provisioning PR, dry run, then `--apply`.
   5. pppmtl `feature/multi-brand`, then the Food Hub hours and seed PR.

   on2goca `feature/on2go-directory` is independent and can merge any time.
8. **PR #27** (`feature/food-hub`): close it, or keep it frozen, so two Food Hub-in-V1 efforts do not compete.
9. **Freeze.** Does the "#27 Food Hub" freeze in `docs/DEV-TODO.md` also cover T8 to T10?
10. **Developer sign-offs:** the pull pattern (K1), the link table (T9), and V1 rows first filled from the feed under the field-ownership table.

## 7. Do-not-break list

- **Po Poulet NDG is never linked.** Never link the DoorDash store named in `CLAUDE.md` §4 and in `FORBIDDEN_STORE_IDS`. Guards stay in Food Hub, ON2GO and the V1 validator and planner. Po Poulet appears only at Saint-Léonard.
- **Never "24/7" and never "24 h"** anywhere: copy, alternate names, cards, JSON-LD.
- **Public facts only.** No emails, phone numbers, merchant ids, tokens, case numbers or Google ids in takatak-v1 code, snapshots or this repo.
- **No false ownership claim.** "Owns and operates" appears only for brands the owner confirmed as GROUPE TAKATAK, with a date.
- **Tenant isolation in V1.** Every brand, location and invitation stays inside its own workspace. No cross-workspace queries in the sync.
- **One workspace per brand,** with the Quadro Holding admin as owner member on all of them.
- **Brand logins by invitation only.** No shared passwords. Agents never type passwords or codes.
- **Hours are fixed at the source** (Food Hub Settings → Hours, then pppmtl and the seed), never typed into takatak-v1.
- **No order buttons on takatak.ca.** Ordering stays on ON2GO. Each platform hears only about itself.
- **No feed colours on takatak.ca** (BRAND.md: green and red are for status only).
- **"Connected" only after a real live fetch** succeeds. The snapshot never counts.
- **The sync never deletes or archives,** never overwrites a field a user changed in V1, and never bypasses plan gates.
- **No force push or rebase of pushed commits on pppmtl** (Lovable). **No deploys by agents.**

## 8. How agents log this work

- **Do not open a new task.** This is task 20. Continue its row in foodhubca `docs/PROGRESS.md`, and the takatak-v1 claim on `claude/provision-brand-workspaces`.
- **Before starting, in every repo you touch,** read `head -40 WORKLOG.md` and `gh pr list`. Add or update one line with status `active`.
  - Format: `YYYY-MM-DD | agent | branch → PR | status | what | next step`
  - Repos: foodhubca, takatak-v1, knowledgeAI, and pppmtl or on2goca only if touched.
- **foodhubca also needs** its Task board row (task 20) and a short dated entry at the top of `docs/PROGRESS.md`. Commit and push the claim before writing code.
- **About every 20 minutes, and before you stop,** update the line: status (`active`, `PR #n`, `done`, `blocked: reason`), the exact next step, and the 2–3 files to read.
- **One task, one branch, one owner.** One PR per finished piece (for example PR 1 = T2 to T6). Post the same short status on the PR.
- **Operations work stays out of git.** Coolify deploys, Settings → Hours and invitations go in the owner's private claims and ops log.