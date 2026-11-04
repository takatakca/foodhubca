# Order confirmations: photo proof for chargeback disputes

> **Pour le propriétaire :** chaque photo que l'équipe poste dans Messenger (« Resto-Order Checker ») prouve qu'une
> commande a été faite et remise. Les photos sont classées par plateforme (Uber Eats, DoorDash, Skip, Too Good To Go)
> dans un dossier **privé** de votre PC, avec un classeur que les agents remplissent pour relier chaque photo à une
> commande et à une retenue. Rien de personnel n'est publié ici : ce fichier décrit seulement la méthode.

Created 2026-10-31 by the "Food delivery provider integration" agent (Claude Code desktop) on the owner's order.

## Why
The platforms charge the restaurant back when a customer reports "item missing" or "wrong order". The staff already
photograph each order before it leaves (the tablet order screen, the bag labelled with the customer's first name, the
pickup proof). Matched to the platform's order number, those photos are the evidence for a dispute, sent through the
platform's portal or by e-mail.

## Where the data lives (private, never in git)
`private/finance/confirmation-of-orders/` in the owner's checkout (the `private/` folder is git-ignored), with a copy of
the notes in the owner's Google Drive (« 00 — Opérations TAKATAK » → « Confirmations de commandes — preuves photo »).

| Path | Content |
|---|---|
| `CONFIRMATIONS-DE-COMMANDES.xlsx` | The workbook agents keep filling: Read me, All photos, one sheet per platform, Disputes, Promo gaps |
| `uber-eats/`, `doordash/`, `skip/`, `too-good-to-go/` | Photos sorted by platform |
| `a-classer/` | Photos with no readable platform (e.g. a bag labelled with a first name), to pair with the order screen sent just before |
| `_inbox/` | Originals as exported from Messenger, never edited |
| `classified.json` | One record per photo (platform, order number, store, date on the photo, Messenger send time, what it shows, proof strength) |

Photo names: `YYYY-MM-DD_<order number>_<store>_mNNNN.jpg` (date = Messenger send time; `mNNNN` = message rank).
Customer = first name + last initial exactly as the platform shows it, and courier = the name the platform shows: both
are kept on purpose, because the platforms ask for them on the phone to find an order, and to follow up on couriers.

## Workbook columns
- **All photos / per platform:** platform, order number, store, date on the photo, Messenger send time, customer (first
  name + initial), courier, items, total, what the photo shows, proof strength, file, linked charge, notes.
- **Disputes:** platform, order number, store, date, customer, courier, platform reason, amount charged, platform status,
  proof photos, our dispute status, sent via (portal / e-mail), date sent, result, agent, notes.
- **Promo gaps:** platform, store, advertised promotion, amount charged, gap, period, proof, status, notes (e.g. a "$5
  off" promotion billed $6.99, credited back after a call).

## How an agent works it
1. Load the newest photos from the Messenger conversation, save them to `_inbox/`, read each one (platform, order
   number exactly as printed, store, date), sort it, add a row.
2. Read the platform's issues list (Uber Eats Manager → Orders → History → order issue; DoorDash Merchant Portal →
   Orders; Skip; Too Good To Go) and add one Disputes row per charge; link the photos by order number.
3. Prepare the dispute text in the owner's voice, one platform at a time: **a message to one platform never names
   another platform**. The owner clicks Submit himself and attaches the photo. Newest charges first: platforms accept a
   dispute only for a short time after the charge.
4. Never put passwords, card or bank numbers in the workbook; never copy any of it into this repository.

## First run (2026-10-31)
450 photos read out of about 950 loaded (late June to 2026-10-30): Too Good To Go 156, Uber Eats 140, DoorDash 72,
Skip 3, unreadable 79 (mostly labelled bags). Every Uber Eats charge found on the first page of the last two weeks had a
matching tablet-screen photo. Remaining: the older photos, the other charges of the last 12 weeks, DoorDash and Skip
charges, and the promo check.

— Claude (Food Hub code agent)
