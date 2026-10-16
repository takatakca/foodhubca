# Too Good To Go order e-mails → Food Hub → Clover

Too Good To Go has no public store API. It does send the store account **one e-mail per reservation** ("order
confirmation") and **one per cancellation**. Food Hub reads those e-mails and handles them like any platform order.

```
TGTG e-mail ──► mailbox (IMAP, read-only)  ─┐
            └─► forwarding service ─► webhook ┴─► reader (FR/EN) ─► store mapping ─► order pipeline
                                                                                     ├─ kitchen screen
                                                                                     ├─ Clover order, type "Too Good To Go"
                                                                                     ├─ kitchen ticket: customer, bags, pickup window, TGTG code
                                                                                     └─ paid with the "Too Good To Go" tender at pickup
```

## What happens

| E-mail | Food Hub |
|---|---|
| Reservation | An order on the Too Good To Go channel, id `tgtg-mail-<TGTG code>`. Same pipeline as Uber Eats / DoorDash / Skip orders: kitchen screen, Clover order with the order type **Too Good To Go**, title `Too Good To Go #<code>`, note `TGTG <code> \| <NAME> \| <n> SACS / BAGS \| RAMASSAGE / PICKUP <window>`, one Clover line per bag with the label text. The kitchen ticket prints on arrival, or at (pickup start − prep time) when the pickup is more than an hour away. The browser ticket (`/ticket/<id>`) adds one big label per bag (name, bag n/N, pickup window, code) to stick on the bag. |
| Picked up | Staff press Ready, then Completed (or the order auto-completes 90 min after the pickup start): the Clover order is recorded **paid with the "Too Good To Go" tender**, like every platform order (payments are recorded when the order leaves, so a cancellation before that can still be undone in Clover). |
| Cancellation | The order is cancelled ("cancelled by the customer"). Its Clover order is **flagged** — renamed `CANCELLED — Too Good To Go #<code>` with a "do not make, do not hand over" note in front of the existing note (TGTG code, customer, bags and pickup window are kept) — and **never deleted**. It stays **open and unpaid** in Clover (Clover has no void without a delete), listed under that CANCELLED title. `FOODHUB_CLOVER_DELETE_CANCELLED=off` also stops the flag (Clover is then not touched on cancellations). A cancellation that arrives before its reservation waits; the reservation is then cancelled on arrival (nothing goes to Clover). |
| Unreadable (no code — a code always has a digit, a word like "confirmation" is never taken for one — or no store name) | Kept in the **attention list** (Settings → Platforms → Too Good To Go by e-mail) with the reason. "Retry" reads it again after a fix. Never dropped. |
| Store name not mapped (or unmapped by the owner) | The order is created on the Command Center only: **not sent to any Clover register** (not even when there is only one), not printed, not accepted automatically. The e-mail is in the attention list. Mapping the store links the waiting orders to their kitchen and sends them to Clover. Removing a mapping stops new e-mails from reaching that kitchen at once; the store it created stays only so orders it already sent can still be paid or flagged. |
| Sender not verified | The From address is Too Good To Go's but the mailbox's own mail server does not vouch for it (topmost `Authentication-Results`: no `dkim=pass header.d=` / `dmarc=pass header.from=` on that domain). Nothing is created, printed or cancelled; listed under Needs attention. |
| Could not be handled (malformed message, unexpected error) | Kept as **error** under Needs attention with the reason and a Retry; the e-mails after it go on. Only a database outage stops the run (the mailbox is read again from that e-mail next time; the webhook answers `503`). |
| Read after the pickup window (+15 min) | Not sent to the kitchen (status "read too late", in the attention list): check the TGTG app. |
| Newsletter, payout, other TGTG mail | Ignored (listed, body not kept). |
| Mail from anyone else | Never downloaded from the mailbox (only its envelope and `Authentication-Results` are read); on the webhook it is ignored and its body is not kept. Only the **From** address counts: Sender, Reply-To, X-Original-From are never trusted. |

**Never twice.** Each e-mail is recorded by its Message-ID, and the order id is the TGTG code: the same e-mail read
twice, the same reservation arriving by IMAP and by the webhook, or a resend never creates a second order or a second
ticket.

## Owner steps

1. **Too Good To Go e-mails ON** — TGTG Store app / portal → Settings → Account → Notifications → Order confirmations:
   Email ON. *Already done for the ooeuf.ca account.* Do the same for every TGTG store account.
2. **A mailbox Food Hub can read.** Either:
   - the store account's own mailbox, if its host allows IMAP with an app password (Gmail: turn on 2-step verification,
     create an *app password*; Google Workspace may need IMAP allowed by the admin); or, better,
   - a **dedicated mailbox** (e.g. a new `tgtg@…` mailbox at the e-mail host) and a **forwarding filter** in the store
     account: *from* `toogoodtogo` → forward to that mailbox. Automatic forwarding keeps the original sender and Too
     Good To Go's DKIM signature, so the sender check (From + `dkim=pass`) still passes. If the forwarded e-mails arrive
     "From" your own address, add that exact address to `TGTG_EMAIL_FROM_ALLOW` (its domain must still pass DKIM / DMARC
     at the receiving server).
   Food Hub opens the mailbox **read-only**: nothing is marked read, moved or deleted.
3. **Hosting environment (Coolify → Food Hub → Environment)** — paste the values there, never in chat:

   | Variable | Value |
   |---|---|
   | `TGTG_IMAP_HOST` | e.g. `imap.gmail.com` or the host's IMAP server |
   | `TGTG_IMAP_PORT` | `993` (TLS; default) or `143` (STARTTLS) |
   | `TGTG_IMAP_SECURE` | optional: `true` = TLS from the start, `false` = STARTTLS; empty = from the port |
   | `TGTG_IMAP_USER` | the mailbox login |
   | `TGTG_IMAP_PASSWORD` | the mailbox (app) password |
   | `TGTG_IMAP_MAILBOX` | optional, default `INBOX` (or the folder the filter files them in) |
   | `TGTG_IMAP_POLL_S` | optional, default `60` seconds (minimum 20) |
   | `TGTG_IMAP_LOOKBACK_H` | optional, first read looks back this many hours (default 12) |
   | `TGTG_EMAIL_FROM_ALLOW` | optional, default Too Good To Go's domains; comma-separated domains or addresses |
   | `TGTG_EMAIL_AUTHSERV_ID` | optional: the first word of your mailbox server's `Authentication-Results` (e.g. `mx.google.com`); empty = the topmost header |
   | `TGTG_EMAIL_WEBHOOK_SECRET` | optional: only to use the webhook below |
   | `TGTG_EMAIL_WEBHOOK_QUERY_TOKEN` | optional, default off: `on` accepts the secret as `?token=` (only for a forwarder that cannot send a header) |
   | `TGTG_EMAIL_LATE_GRACE_MIN` | optional, default `15` |

   Redeploy. With none of these set, the feature is completely off.
4. **Settings → Platforms & Clover → Too Good To Go by e-mail**: the switch is on by default once configured.
   Map each store name exactly as TGTG writes it in its e-mails to a brand and kitchen, e.g. `OOEUF NDG` → OOeuf @ NDG
   (6280 / 6284 Av Somerled — pick the kitchen that makes the bags). Saint-Léonard / Jean-Talon = 5839 Rue Jean-Talon E.
   Po Poulet is accepted at Saint-Léonard only. Names seen in e-mails but not mapped yet show as buttons with a
   suggestion. The Clover register is the one already used by that kitchen (or pick it).
5. **Clover**: the order type "Too Good To Go" and the tender "Too Good To Go" already exist; Food Hub finds them by
   name (it creates them only if they are missing).
6. **Check**: the first real TGTG e-mail appears under "Last e-mails read". If it lands in "Needs attention", send the
   e-mail (names and code hidden) to the developer: the reader gets a new pattern and a test.

## Webhook (optional, for a forwarding service)

`POST https://<food hub>/api/foodhub/webhooks/tgtg-email` with `Authorization: Bearer <TGTG_EMAIL_WEBHOOK_SECRET>`
(or `X-Api-Key`, `X-Takatak-Token`). Prefer the header: `?token=` in the URL ends up in access logs and is refused unless
`TGTG_EMAIL_WEBHOOK_QUERY_TOKEN=on`. The 5 MB cap is enforced while the body is read (chunked bodies too). Bodies accepted:

- raw MIME (`Content-Type: message/rfc822` or `text/plain`) — Cloudflare Email Workers, a Gmail Apps Script, Postmark raw;
- JSON `{ "from", "subject", "text", "html", "messageId", "date", "authResults" }` or `{ "raw": "<MIME source>" }`;
- form fields: Mailgun (`from`, `subject`, `body-plain`, `body-html`, `Message-Id`, `Date`), SendGrid Inbound Parse
  (`from`, `subject`, `text`, `html`, `headers`, `dkim`, or `email` = raw MIME). The service must pass the receiving
  server's `Authentication-Results` (in the raw MIME, `headers`, Mailgun `message-headers`, SendGrid `dkim`, or
  `authResults`): without a DKIM / DMARC pass for the From domain nothing is acted on.

Answers: `404` while the secret is not set, `401` bad token, `503` switched off or database unreachable (the service
retries), `200 { status }` otherwise (`order_created`, `duplicate`, `cancel_applied`, `cancel_pending`, `attention`,
`too_late`, `ignored`, `error`). Two copies of one reservation at the same time: the second waits for the first, then
answers `duplicate` (or does the work if the first failed).

## How the e-mail is read

`lib/foodhub/tgtg-email/parse.ts` — pure, French and English, separate patterns tried in order:

1. **labelled lines** — `Order number: …`, `Numéro de commande : …`, `Client`, `Quantité`, `Montant payé`, `Collecte`,
   `Magasin`, … (also a table row `label ⇥ value`, or a value on the next line);
2. **sentences** — "Marie just reserved 2 Surprise Bags", "Sophie vient de réserver 3 Paniers Surprises chez …",
   "Lucas a annulé sa réservation";
3. **the subject** — "New order #W9XK3L7Q – OOEUF NDG" (a marker — `#`, `n°`, `no.`, `number`, `numéro`, `id`, `code`,
   `ref` — is required after "order" / "commande"; "Order confirmation" or "Order details" never give a code).

The price paid is taken by priority: `Total paid` / `Amount paid` / `Montant payé` first, a generic `Price` / `Total`
only when none is written (a "Price: $14.99 value" line never wins over "Total paid: $4.99").

Pickup windows: `17:00 - 17:30`, `17 h 00 – 17 h 30`, `17h-17h30`, `5:00 - 5:30 PM`, with a date (`Friday, October 16,
2026`, `vendredi 16 octobre`, `16/10/2026`, `2026-10-16`, `today` / `aujourd'hui`, `tomorrow` / `demain`, a weekday),
converted from America/Toronto local time (daylight-saving safe). The code and the store name are never guessed.

Fixtures: `tests/fixtures/tgtg-email/*.eml` are **synthetic** (Too Good To Go publishes no format and no public sample
was found); tests: `tests/tgtg-email.test.ts`.

## Code map

| File | Role |
|---|---|
| `lib/foodhub/tgtg-email/parse.ts` | the reader (pure) and the sender check |
| `lib/foodhub/tgtg-email/mime.ts` | raw MIME → e-mail (`mailparser`) |
| `lib/foodhub/tgtg-email/ingest.ts` | e-mail → order / cancellation, idempotency, attention list, retry |
| `lib/foodhub/tgtg-email/imap.ts` | read-only IMAP poller (`imapflow`), cursor, throttled tick |
| `lib/foodhub/tgtg-email/inbound.ts` | webhook body formats + token check |
| `lib/foodhub/tgtg-email/settings.ts` | switch, store mapping (+ the TGTG store it creates), e-mail log, mailbox status |
| `lib/foodhub/tgtg-email/ids.ts` | order ids; `isTgtgEmailOrder` (Clover cancel = flag, never delete) |
| `app/api/foodhub/webhooks/tgtg-email/route.ts` | inbound webhook |
| `app/api/foodhub/tgtg-email/route.ts` | Settings API (`stores:map`) |
| `app/(console)/settings/channels/tgtg-email.tsx` | Settings → Platforms section |

The mailbox is read from the existing heartbeat: `/api/foodhub/cron/watch`, the live pulse of open screens and the
server timer (`instrumentation.ts`), at most every `TGTG_IMAP_POLL_S`.
