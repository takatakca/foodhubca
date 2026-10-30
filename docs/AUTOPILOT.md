# Pilote automatique / Autopilot (Réglages → Pilote automatique)

## En bref (français)

- **Où :** Réglages → *Pour vous* → **Pilote automatique** (`/settings/autopilot`). Tout le monde voit la liste ; seuls
  un **gérant de toutes les succursales** ou le **propriétaire** changent les interrupteurs.
- **Ce que la page montre, pour chaque automatisation :** son interrupteur (ou l'endroit où il se trouve), sa règle en
  mots simples, son dernier passage, ce qu'elle a fait la dernière fois, et l'annulation quand elle existe.
- **Ce qui tournait déjà** garde son interrupteur là où il était (garde tablette par cuisine, règle de surveillance,
  réglage du serveur) ou est toujours actif. La page **lit** cet état ; elle n'en garde pas de copie.
- **Trois nouveautés, arrêtées par défaut :**
  1. **Republier 10 min après un changement** : après « Prendre le prix Clover » ou après l'enregistrement des heures,
     le menu de la marque est publié 10 minutes plus tard. Plusieurs changements = une seule publication (au plus
     30 minutes après le premier). Jamais une marque dont tous les magasins sont protégés ; les magasins protégés sont
     laissés de côté. Annulable sur la page tant que la publication n'a pas commencé.
  2. **Réessayer les envois refusés** : une publication, un 86 ou une pause **refusé** par une plateforme est renvoyé
     au plus 3 fois (après 2, 10 puis 30 min), puis une alerte s'ouvre dans la surveillance. Seulement ce qui n'a pas
     déjà son propre nouvel essai. Un changement fait entre-temps par une personne gagne toujours. Arrêtable sur la page.
  3. **Rapport de paiement Uber chaque semaine** : le lundi à 6 h (heure de Montréal), Food Hub demande à Uber le
     rapport de paiement de la semaine d'avant ; il est importé dès qu'Uber l'envoie. Lecture seulement.
- **Journal :** chaque geste des nouveautés est écrit au journal d'activité avec l'acteur **« Autopilot »** (source
  *automation*). Qui a activé ou arrêté un interrupteur est écrit aussi, à son nom.
- **Toutes arrêtées = Food Hub fait exactement comme avant.**
- **Règles fixes :** aucune IA ne décide ici. Le pilote automatique n'approuve rien, n'affiche aucun message ni avis
  au nom du restaurant, ne supprime rien et ne règle aucune question d'argent. **Po Poulet NDG (DoorDash)** et
  tout magasin protégé ne sont jamais mis en pause, rouverts, publiés ou mis en 86 par une automatisation.

---

## Summary (English)

Settings → *For you* → **Autopilot** (`/settings/autopilot`) lists every automation Food Hub runs by itself, with its
switch, its rule in plain words (French first, English beside it), the last time it ran, what it did last and an
undo where one exists. MASTER_PLAN Phase 4, items 1 and 2.

### Who can change what

| Action | Who | Route |
|---|---|---|
| See the list | every signed-in role (`view`) | `GET /api/foodhub/autopilot` |
| Switch a new automation on / off | manager or owner (`stores:map`, the Settings role check), for **every** location | `PUT /api/foodhub/autopilot { id, on }` |
| Undo: cancel a waiting re-publish, stop a retry | same | `POST /api/foodhub/autopilot { action: 'cancel_publish' \| 'stop_retry', id }` |

A manager limited to some locations cannot flip a switch: a switch acts on every kitchen.

### The list

| Automation | New? | Switch | Last run / what it did read from |
|---|---|---|---|
| Re-publish 10 min after a change | yes, OFF | here (`autopilot_switches_v1`) | its own note (`autopilot_runs_v1`) |
| Retry refused sends | yes, OFF | here | Autopilot heartbeat (`autopilot_tick_last`) + note |
| Weekly Uber payment report | yes, OFF | here | `autopilot_uber_weekly_v1` + note |
| Tablet-off guard | no | per kitchen, Stores → Availability (`downtime_guard_v1`) | availability heartbeat + last activity line of « Garde tablette » |
| Clover auto-retry | no | server setting `FOODHUB_CLOVER_RETRY_S` | last `clover_retry_ok` / `clover_retry_gave_up` activity line |
| Re-open after a timed pause | no | always on | last sync + note |
| Back in stock after a timed 86 | no | always on | last sync + note |
| Scheduled publishes | no | always on (cancel in Menus) | last sync + note |
| Auto-close of stale orders | no | server setting `FOODHUB_AUTO_COMPLETE_MIN` (0 = off) | last sync + note |
| Unmapped store: mapping hint | no | Watchtower rule `store_unmapped`, Settings → Alerts (owner) | Watchtower run + last `store_unmapped` incident |
| Clover inventory to the platforms | no | server setting `FOODHUB_CLOVER_INVENTORY_SYNC` | last sync + note |
| Closed holidays on Skip | no | always on | last sync + note |
| Daily reconciliation | no | always on | `recon_daily_run` + note |

The existing automations keep their own actor names in the activity log (« Garde tablette », « TAKATAK automation »,
« Scheduled by … », « Food Hub »): renaming them would change what they do today (the busy schedule, for one, finds its
own changes by its actor name). The notes for the sync-driven ones are written by `runAutopilot` only when a run did
something; their behaviour is untouched.

### The three new automations

**Re-publish 10 min after a change** (`lib/foodhub/autopilot/republish.ts`)
- Triggers: `POST /api/foodhub/menu/clover-prices` with `accept: true` (« Use Clover price ») → every brand that
  publishes that menu (the menu's owner and the brands sharing it); `PUT /api/foodhub/hours` and
  `POST /api/foodhub/store-availability/special-days` → the brands whose published hours changed (own hours, a store at a
  location whose hours changed, or the locations of an added / removed / changed holiday; a holiday with no location
  means every brand).
- Reuses `menu/schedule.ts`: one `schedulePublish` entry per brand (`by: 'autopilot'`, `storeIds` = the brand's stores
  an automation may touch), moved back with `postponeScheduled` on each new change, never later than 30 minutes after
  the first. It runs through `runDuePublishes` like any scheduled publish and logs as « Autopilot ».
- Never: a brand whose stores are all protected (`isLockedStore` + `menuChangesRefused`: Po Poulet NDG by id or DoorDash
  number, a locked menu, « Do not touch »); a brand with no master menu or an empty shared dish list.
- Undo: « Annuler » on the page (`cancelScheduled`).

**Retry refused sends** (`lib/foodhub/autopilot/retry.ts`)
- Picks up jobs with status `error` (a platform refusal; `blocked` = never sent, not retried) of kind `menu_push`,
  `item_toggle` and `store_toggle` (pauses only), created after the switch was turned on and in the last 2 hours.
- Left out because they already retry: resumes after a timed pause (`reopenExpiredPauses`, 5 / 15 / 60 min), the
  tablet-off guard's pauses, holiday closures (re-applied every sync), Clover orders (`order-retry.ts`).
- At most 3 retries, 2, 10 then 30 minutes apart, 5 sends per heartbeat, through the same fan-out as a click
  (`publishMenu`, `setItemAvailability`, `setStoresOnline` with actor « Autopilot »). The jobs Autopilot writes are
  remembered so they are never taken for a new refusal.
- Not sent again when: the store is protected, removed or a relay store; a newer action on the same store (and the
  same items for an 86) exists; the 86 or pause end time is over; the store is already paused; the 86 state in Food
  Hub no longer matches. A blocked answer (live connector off) ends the chain.
- After the third refusal: a Watchtower incident (`menu_failed`, key `autopilot_retry:<job id>`) until a later send to
  that store works, a person stops it on the page, or 6 hours pass.

**Weekly Uber payment report** (`lib/foodhub/autopilot/uber-weekly.ts`)
- From Monday 06:00 in the hub's time zone (`FOODHUB_TIMEZONE`, America/Toronto by default), asks Uber for the previous
  Monday → Sunday Payment Details report with `requestUberPaymentReport` (the same call as Money → Statements). Uber
  calls the report webhook, which imports it and refreshes the money cases.
- One request per week; a refused one (Uber not connected, live switch off, an error) is tried again at most twice,
  6 hours apart.

### Heartbeat

`runAutopilot` runs from the sync engine (`lib/foodhub/sync.ts`, after the daily reconciliation): it notes what the
existing housekeeping did, then runs the retries and the weekly report if their switch is on. With every new switch
off it reads its switches and stops. The re-publish needs no heartbeat: it is scheduled at the moment of the change.

### Tests

`tests/autopilot.test.ts`: every switch off = nothing runs and nothing is written; a switch persists in the repo kv
across a module reload; only a manager of every location or the owner can switch; re-publish (one entry, coalesced,
unprotected stores only, runs as Autopilot, cancel); retries (2 / 10 / 30 min, 3 at most, incident, success stops,
a newer person action wins, protected / guard / blocked / before-switch refusals never retried, stop); the weekly
window and its tries; the page renders every automation with rule, state, last run and what it did, in both languages.
