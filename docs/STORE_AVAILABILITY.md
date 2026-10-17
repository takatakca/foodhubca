# Centre de disponibilité / Store availability center

Page : **`/stores/availability`** (accessible par l'URL pour l'instant). Elle complète « Statut et pauses » (`/stores`) sans
la modifier : la pause et la reprise d'un magasin restent sur `/stores`, les heures et les fériés du Québec restent sur
`/stores/hours`.

Code : `lib/foodhub/store-availability/**`, `app/api/foodhub/store-availability/**`,
`app/(console)/stores/availability/**`. Tests : `tests/store-availability-*.test.ts`, `tests/busy-schedule.test.ts`,
`tests/downtime-guard.test.ts`, `tests/special-days.test.ts`.

## 1. Statut maintenant (`GET /api/foodhub/store-availability`, permission `view`)

Pour chaque cuisine : résumé (« Tout ouvert », « N en pause », « Fermé (heures) »), tablettes en ligne / inscrites,
temps de préparation et mode occupé, « Ouvre / Ferme à … ». Pour chaque marque et chaque canal (Uber Eats, DoorDash,
Skip, Too Good To Go) :

| Champ | Sens |
|---|---|
| `state` | `meta.platformStatus.state`, sinon `online` / `paused` ; `closed` quand le magasin est en ligne mais hors des heures de la marque |
| `by` | `TAKATAK` (pause du tableau de bord), `plateforme` (vue par la synchro ou un webhook), `garde` (garde tablette), `horaire` (heures ou fermeture fériée) |
| `reopensAt` | fin de la pause (ou la prochaine ouverture après elle si la cuisine est fermée à ce moment) ; prochaine ouverture si fermé par les heures ; rien pour une pause sans fin (réouverture à la main) |
| `locked` | magasin « ne pas toucher » ou magasin DoorDash interdit (`FORBIDDEN_STORE_IDS`) : jamais touché par un automatisme |

Les magasins relais (`relay:…`) ne sont pas montrés : ils reçoivent seulement des commandes.

**Clover Online Ordering** : une ligne « à faire dans Clover : mettez aussi en pause dans Clover » pour la marque du site
web (`FOODHUB_CLOVER_WEBSITE_BRAND`, sinon la seule marque de la cuisine), quand les commandes du site sont actives.
Aucun appel à Clover. Recherche faite dans la documentation Clover : pas de point d'API officiel pour mettre en pause la
commande en ligne (la pause se fait dans l'application Online Ordering de Clover).

« Rouvre à … » vient de `next-open.ts` (`nextOpening`), construit sur `openIntervals` de `hours.ts` : créneaux après
minuit (16:00–03:00), fériés fermés, heures spéciales des fériés, jours de changement d'heure.

## 2. Historique (`GET /api/foodhub/store-availability/history`, `view`)

Lu dans le journal d'activité (types `store_status` et `hours`) : pause, reprise, changements des plateformes
(`platform_*`), occupé on/off, temps de préparation, fermeture fériée, jours spéciaux, heures, garde (pause / reprise),
réouverture échouée, calendrier occupé. Chaque ligne : quand, cuisine, marque, canal, événement, jusqu'à, raison, par
qui, résultat `ok` / `blocked` (non envoyé : interrupteur live éteint ou clé absente) / `failed`.
Filtres `?days=` ou `?from=&to=` (92 jours au plus), `&location=`, `&brand=`, `&channel=`. `?format=csv` : export
(UTF-8 avec BOM, cellules protégées contre les formules : `= + - @` en tête, même après des espaces, ou une tabulation /
un retour chariot en tête). Au plus 5000 lignes du journal par lecture (`HISTORY_READ_LIMIT`) : au-delà, la réponse
porte `truncated: true` (en-tête `x-history-truncated` pour le CSV) et la page demande de réduire la période.
**Pas de % d'indisponibilité ici** : `analytics.ts` et la page qualité des opérations les calculent.

## 3. Calendrier occupé (`/busy-schedule` : GET `view`, PUT `stores:toggle` + approbation `store.busy`)

`fh_kv busy_schedule_v1` : `{ [cuisine]: [{ id, days, start, end, extraMin 5–60 }] }` (validé par zod, pas de plages qui
se chevauchent, une plage peut passer minuit). Le battement (`tickBusySchedule`) agit **aux bornes seulement** :

- début de plage, cuisine pas en mode occupé : l'état est d'abord enregistré dans `busy_schedule_state_v1`, puis
  `savePrep(isBusy, busy = normal + extraMin)` au nom de « Calendrier occupé » (son propre acteur, `BUSY_ACTOR`), puis
  `pushPrepTimeToUber` (déjà limité au mode live). Un mode occupé déjà écrit par « Calendrier occupé » au début d'une
  plage (état perdu) est repris comme le sien : la fin de plage l'arrête ;
- fin de plage : retour au temps normal et remise des minutes « occupé » d'avant, **seulement si le dernier changement
  vient encore du calendrier**. Si une personne a changé le mode occupé pendant la plage, son choix l'emporte (pas de
  remise, pas de réactivation dans la même plage). Si le mode occupé est resté activé ainsi, une ligne
  `busy_schedule_kept` va dans l'historique (« Occupé resté activé ») et l'onglet affiche un avertissement jusqu'à ce
  que le mode occupé soit arrêté.
- Déjà en mode occupé au début : le calendrier ne touche à rien, ni au début ni à la fin.

## 4. Garde tablette éteinte (`/guard` : GET `view`, PUT `stores:map`) — ÉTEINTE par défaut

`fh_kv downtime_guard_v1` : `{ [cuisine]: { enabled false, graceMin 5 (3–30), pauseMin 30 (15–120), channels } }`.
Elle agit seulement quand : une marque de la cuisine est ouverte selon les heures (heures non définies = jamais),
au moins une tablette est inscrite et non révoquée, et **toutes** les tablettes sont silencieuses depuis `graceMin`
**pendant les heures d'ouverture** : le délai compte à partir du plus tard entre le dernier signal des tablettes et
l'ouverture de la marque (une tablette éteinte la nuit ne déclenche rien à la première minute du service).

- Pause : `setStoresOnline(ids, false, { untilMs: maintenant + pauseMin, reason: 'Tablette de cuisine éteinte' })` pour
  les magasins en ligne des canaux choisis, **des marques ouvertes à ce moment seulement**. **Jamais** : relais,
  « ne pas toucher », le magasin DoorDash interdit par le propriétaire (`FORBIDDEN_STORE_IDS` et le verrou intégré).
- Tant que les tablettes restent éteintes : prolongation toutes les `pauseMin / 2` (une panne du serveur ne laisse donc
  jamais un magasin en pause longtemps : la réouverture des pauses minutées existante prend le relais).
- Une tablette revient (ou la garde est éteinte) : reprise **seulement** des magasins qu'elle a mis en pause et qui portent
  encore sa raison dans `meta.platformStatus.detail`. Une pause faite par une personne entre-temps est gardée.
- Résultats bloqués (live éteint) ou refusés par la plateforme : pas comptés comme en pause, journalisés
  (`guard_blocked`) et comptés dans l'état (`blocked`, `failed`) ; nouvel essai des autres magasins en ligne après
  `pauseMin / 2`, pas à chaque battement. Un état sans magasin (`storeIds: []`) ne vise jamais toute la cuisine.

## 5. Jours spéciaux (`/special-days` : GET `view` ?year=, POST `menu:edit`)

Halloween (31 oct.), jour du Souvenir (11 nov.), veille de Noël (24 déc.), lendemain de Noël (26 déc.), veille du jour
de l'An (31 déc.), Saint-Valentin (14 févr.), fête des Mères (2e dimanche de mai), fête des Pères (3e dimanche de juin).
Ajoutés comme fériés (fermé, ou heures spéciales validées par `holidaySlotErrors`) via `getHours` / `saveHours`, sans
doublon de date pour les mêmes cuisines. Les créneaux envoyés sont validés strictement (1 à 6 `{ open, close }`, rien
d'autre). Rien n'est publié d'ici : publiez avec « Publier sur les plateformes » sur `/stores/hours`.
**Exception, déjà dans Food Hub :** un jour **fermé** met aussi les magasins **Skip** de la cuisine hors ligne ce jour-là,
automatiquement et sans publication (`applyHolidayClosures`, lancé par la synchro, jusqu'à minuit). La page le dit
quand « Fermé » est choisi.

## 6. Battement

`tickAvailability()` (`tick.ts`) : calendrier occupé puis garde, au plus toutes les 30 s (`fh_kv
availability_tick_last`), un seul à la fois, ne lève jamais d'erreur. Appelé dans `cron/watch` (clé `availability` du
JSON), dans le `after()` du pulse, et dans le minuteur de `instrumentation.ts`.

## 7. Plus tard (pas dans cette branche)

Ajouter l'onglet dans `app/(console)/stores/stores-tabs.tsx` (fichier de `feature/client-dashboard-easy`) :

```ts
{ href: '/stores/availability', label: t('Disponibilité', 'Availability') },
```

---

**EN, short.** `/stores/availability` adds what "Status & pauses" lacks: per-channel status with who paused and when it
reopens (overnight hours, holidays, DST), a Clover Online Ordering reminder row (no Clover call; no official pause
endpoint found), a status history with CSV (no downtime %), a busy schedule that acts only at window edges (a person's
change wins), a tablet-off guard that is OFF by default and only resumes its own pauses (never relay, "do not touch" or
forbidden DoorDash stores; grace time counted from the opening, closed brands left alone, failed pauses retried), and
one-tap special days (publish from /stores/hours; a closed day also takes Skip offline automatically that day).
Times on the page are shown in the hub's zone.
