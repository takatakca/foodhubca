# Food Hub Assistant

## Pour le propriétaire (résumé)

L’assistant, c’est l’équivalent de l’« Assistant » du portail marchand DoorDash, mais pour **tous vos canaux en même
temps** : Uber Eats, DoorDash, SkipTheDishes, Too Good To Go, vos sites web, les commandes au téléphone et Clover.

- **Où le trouver :** le bouton ✨ « Copilote » du menu (ou « Demander au copilote » dans l’Aide). Le panneau s’ouvre
  à gauche ; la page reste utilisable à côté. Boutons : *Nouvelle conversation*, *Toutes les conversations*,
  *Réduire*, *Fermer*.
- **Sur chaque page**, il écrit un court résumé avec vos vrais chiffres, puis « Que voulez-vous faire ensuite ? » et
  3 ou 4 suggestions numérotées (touchez-en une pour la demander). Quand quelque chose cloche (beaucoup
  d’annulations, une tablette éteinte, un magasin en pause, des envois de menu refusés…), un bouton **« Examiner »**
  pose la question pour vous.
- **Vous pouvez tout lui demander** : « Analyse mes ventes », « Mes meilleurs articles cette semaine », « Pourquoi des
  commandes annulées ? », « Combien les plateformes me doivent ? ». Il lit les données de Food Hub ; il n’invente
  pas de chiffres.
- **Il ne change jamais rien tout seul.** Pour un prix, un 86, une pause, un temps de préparation ou un brouillon de
  campagne, il affiche une **carte** : ce qui va changer, où, ancien → nouveau. Rien ne bouge avant que vous touchiez
  **Approuver**. À ce moment-là, Food Hub vérifie votre rôle et peut demander le NIP d’un gérant, exactement comme si
  vous aviez fait le changement vous-même. Le journal d’activité note « Assistant (approved by <vous>) ».
- **Po Poulet NDG (DoorDash 27982486) : jamais touché.** L’assistant refuse toute carte qui l’atteindrait et le
  revérifie au moment d’approuver.
- **Micro :** sur Chrome, Edge et Safari, le bouton micro dicte la question (français du Canada par défaut, « EN »
  pour l’anglais). Sinon, on tape.
- **Sans clé IA**, l’assistant marche quand même : résumés, suggestions et réponses intégrées (il le dit en bas du
  panneau).

**Ce que vous avez à faire (une fois, dans Coolify) :** ajouter `ANTHROPIC_API_KEY` (la clé Claude). Optionnel :
`ANTHROPIC_MODEL` (par défaut `claude-sonnet-5-5`) et `FOODHUB_ASSISTANT_EFFORT` (`low` / `medium` par défaut /
`high`). Redéployer. C’est tout.

---

## For developers

### What it is

A left-docked, non-modal panel (`components/assistant/assistant-panel.tsx`) that replaces the old explain-only Copilot
drawer. `components/shell/copilot.tsx` keeps its `CopilotDrawer({ onClose })` export, so the console shell opens it
unchanged (button, mobile sheet tile, `takatak:copilot` event).

| Piece | File |
|---|---|
| Panel UI (FR then EN, keyboard + screen reader, reduced motion, kitchen dark theme) | `components/assistant/assistant-panel.tsx` |
| Approval card | `components/assistant/proposal-card.tsx` |
| Voice input (Web Speech API, `fr-CA` default, `en-CA`) | `components/assistant/voice.ts` |
| Floating nudges (ready to mount) | `components/assistant/nudges.tsx` |
| `openAssistant(question)` from anywhere | `components/assistant/open.ts` |
| Optional page extras (`useAssistantPageContext`) | `components/assistant/page-context.ts` |
| Page snapshot (route + key numbers, server side) | `lib/foodhub/assistant/snapshot.ts` |
| Built-in summaries, next steps, answers (no key) | `lib/foodhub/assistant/suggest.ts` |
| Prompts (frozen system prompt, page-summary prompt) | `lib/foodhub/assistant/prompt.ts` |
| Tools (zod → JSON schema + validation, router) | `lib/foodhub/assistant/tools.ts` |
| Read tools over every channel | `lib/foodhub/assistant/data.ts` |
| Proposal cards (resolve, refuse, store) | `lib/foodhub/assistant/proposals.ts` |
| Approve → existing gated routes as the person | `lib/foodhub/assistant/approve.ts` |
| Po Poulet NDG guard | `lib/foodhub/assistant/protect.ts` |
| Chat loop (streaming, tool use) + page briefs | `lib/foodhub/assistant/chat.ts` |
| Chat history per person (repo kv) | `lib/foodhub/assistant/history.ts` |
| Campaign drafts (saved only) | `lib/foodhub/assistant/campaign-drafts.ts` |

### Routes (all need a session; 401 otherwise)

- `POST /api/foodhub/assistant/chat` `{ question, chatId?, route, extra?, lang }` → NDJSON stream of `StreamEvent`
  (`start`, `text`, `tool`, `proposal`, `brief`, `error`, `done`).
- `POST /api/foodhub/assistant/page` `{ route, lang, extra?, ai? }` → `{ snapshot, brief, aiConfigured }`.
- `GET /api/foodhub/assistant/chats` (list) · `GET …/chats?id=<chat>` (messages; the model prompt stays server side).
- `POST /api/foodhub/assistant/proposals/[id]` `{ decision: 'approve' | 'dismiss' }`.

### Claude

- SDK `@anthropic-ai/sdk`, `client.beta.messages.stream` in a manual tool loop (max 8 steps per question). Model
  `ANTHROPIC_MODEL` or `claude-sonnet-5-5`; adaptive thinking (default), `output_config.effort` from
  `FOODHUB_ASSISTANT_EFFORT` (`medium`), page summaries at `low`. Server-side refusal fallback
  (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`) on models that take it.
- Prompt caching: the system prompt is frozen (no date, no numbers) with `cache_control`; tools are in a fixed order;
  top-level `cache_control` caches the growing conversation during tool round trips. The page snapshot, time and
  language go in the user turn.
- Append-only: within a turn each step's full content (thinking blocks included) is sent back unchanged; earlier turns
  are replayed as the exact prompt sent and the text shown (+ a one-line note per card).
- Tools use `eager_input_streaming`; every input is validated with zod before running (malformed → `is_error` result).
  `max_tokens` with a pending tool call never runs the tool; `refusal` stops the turn.
- No key, or Claude unreachable: the built-in answer and suggestions (`suggest.ts`) — the panel is never empty.

### Read tools (every channel, the person's kitchens only)

`get_sales` (sales mix: platforms + website + Clover + phone; by source / brand / location / weekday / hour /
fulfillment, vs previous period) · `get_top_items` · `get_order_issues` (cancellations, lost items, ops quality vs
goals) · `get_missed_orders` · `get_store_status` (state, pause end, auto-accept, prep times, optional downtime) ·
`get_reviews` · `get_payouts` (imported statements + money to recover; company-wide people only) · `get_incidents` ·
`get_autopilot` · `find_menu_items`. Periods beyond today and reviews/payouts need `analytics:view`.

### Proposals — never executed by the assistant

| Tool | Card | Approve calls (as the person) | Permission |
|---|---|---|---|
| `propose_price_change` | item, platform, old → new price | `PUT /api/foodhub/menu` (menu read fresh; `menu.price` PIN policy) | `menu:edit` |
| `propose_item_availability` | items, kitchen, sold out / back, timed | `POST /api/foodhub/availability` (`item.86` policy) | `items:toggle` |
| `propose_store_pause` | stores, state → paused N min / online | `POST /api/foodhub/stores/status` (`store.pause` policy) | `stores:toggle` |
| `propose_prep_time` | normal / busy minutes, busy mode | `POST /api/foodhub/prep` (`store.busy` policy) | `stores:toggle` |
| `propose_campaign` | draft (nothing sent, no money) | saved in `assistant_campaign_drafts_v1` | `menu:edit` |

Approve (`approve.ts`) uses the **stored** card, never the browser's copy; only the card's author, once, within 24 h;
the role is checked again; Po Poulet NDG is checked again against today's mappings; the gated route handler is
called in-process with the caller's own `cookie` / `authorization` and `x-approval-pin`, so its role check, kitchen
scope, manager-PIN policy (428 → the panel's PIN prompt → retry), menu locks and the live-connector switch all apply.
The result line is honest (stores updated / not sent / failed). Activity log: the route's own line (the person) plus
`approval` · `assistant_approve` / `assistant_dismiss` by `Assistant (approved by <person>)`.

### Locked rules (docs/MASTER_PLAN.md § 6)

- AI explains and suggests; it never approves, posts, deletes or settles money. Every change is a card the merchant
  approves in one tap. Autopilot automations stay manager-switched (off by default).
- Po Poulet NDG (DoorDash 27982486) is never acted on: refused when the store is mapped with the built-in lock (its
  mapping id or DoorDash's own number), when the number appears in a tool input, or when the words name it (Po Poulet
  + NDG or no kitchen + DoorDash or every platform). A kitchen-wide pause leaves it out and says so.
- A campaign draft for one platform never mentions another delivery platform (system prompt).

### Nudges

Signals come from the snapshot (`cancel_spike`, `late_orders`, `orders_waiting`, `store_paused` /
`store_deactivated`, `tablet_off`, `critical_alerts`, `many_86`, `item_errors`, `reviews_unanswered`, `money_owed`).
They show in the panel's page summary with « Examiner » / "Investigate this". The floating chip
(`<AssistantNudges hidden={copilotOpen} />`) is ready; mounting it is a one-line change in the console shell, left to
the shell's owner (this branch does not edit the shell layout).

### Tests

`tests/assistant.test.ts` (tool routing, proposals never execute, approve through the real gated routes with the
person's role and the PIN policy, credentials forwarded, Po Poulet refused before and at Approve, snapshot + built-in
brief) and `tests/assistant-chat.test.ts` (401 without a session, no key → built-in answer and no Claude call, the
streaming loop with the SDK mocked at fetch level — tool results in one user message, thinking blocks echoed,
malformed input rejected, card emitted but nothing executed — and the page-summary prompt + parser).
