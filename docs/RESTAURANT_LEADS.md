# Demandes de restaurants / Restaurant leads (ON2GO.ca → Food Hub)

Le formulaire « Rejoindre ON2GO / Être inscrit » du site statique on2go.ca (dépôt séparé) envoie ses réponses à Food Hub.
Food Hub les garde, avertit le propriétaire par courriel, répond au restaurant (FR ou EN) et les montre dans
**Réglages → Demandes de restaurants** (propriétaire seulement) : statut `new → contacted → won / lost` et notes privées.

The “Join ON2GO / get listed” form on the static on2go.ca site (separate repo) posts to Food Hub. Food Hub stores the
lead, emails the owner, auto-replies to the restaurant (FR or EN) and lists everything under **Settings → Restaurant
leads** (owner only): status `new → contacted → won / lost` plus private notes.

| What | Detail |
|---|---|
| Public endpoint | `POST /api/public/restaurant-leads` (no sign-in; `proxy.ts` lets `/api/public/` through) |
| Preflight | `OPTIONS /api/public/restaurant-leads` → 204 |
| CORS | `https://on2go.ca` and `https://www.on2go.ca` only (writes: no localhost, no partners, no `FOODHUB_PUBLIC_CORS_ORIGINS`) |
| Quota | 5 submissions per 10 minutes per client IP (`x-forwarded-for` only with `FOODHUB_TRUST_PROXY=true` or on Vercel), then `429` + `Retry-After: 600` |
| Body limit | 16 000 bytes (`413`), JSON only (`415`) |
| Storage | `fh_docs` collection `restaurant_leads` (same table as the outbox and payout lines: **no migration**); `at` = received, `key` = status |
| Emails | notification to `FOODHUB_SUPPORT_EMAIL` + auto-reply to the lead, through the usual sender (SMTP or Resend). Without a provider or without `FOODHUB_SUPPORT_EMAIL`, skipped, never an error; both attempts land in the message outbox |
| Console | `GET/POST /api/foodhub/restaurant-leads` (permission `admin` = owner), page `app/(console)/settings/leads/page.tsx` |
| Code | `lib/foodhub/restaurant-leads.ts`, `app/api/public/restaurant-leads/route.ts`, tests `tests/restaurant-leads.test.ts` |

## JSON contract (request)

```json
{
  "restaurant": "Chez Mimi",
  "contact": "Mimi Tremblay",
  "email": "mimi@example.com",
  "phone": "514 555 0199",
  "city": "Montréal",
  "province": "QC",
  "address": "123 rue Test",
  "website": "chezmimi.example",
  "platforms": ["uber", "direct"],
  "brands": 2,
  "message": "Nous aimerions être sur ON2GO.",
  "lang": "fr",
  "source": "on2go.ca",
  "company": ""
}
```

| Field | Required | Rule |
|---|---|---|
| `restaurant` | yes | 2–120 characters; no link (`http`, `://`, `www.`) |
| `contact` | yes | 2–80 characters (person’s name); no link |
| `email` | yes | valid address, ≤ 254; stored lower-case |
| `phone` | yes | North-American number (10 digits, or `+` and 8–15 digits), ≤ 30 characters as typed; stored as E.164 |
| `city` | yes | 2–80 characters; no link. A trailing « , QC » is dropped when it repeats `province` |
| `province` | no | Canadian province or territory postal code (`QC`, `ON`, `BC`, `AB`, `MB`, `SK`, `NS`, `NB`, `NL`, `PE`, `YT`, `NT`, `NU`); any other value → `invalid` |
| `address` | no | ≤ 200 |
| `website` | no | ≤ 200; `https://` is added when the scheme is missing; must be http(s) with a dotted host |
| `platforms` | yes (may be empty) | array of `uber`, `doordash`, `skip`, `tgtg`, `direct`, `phone`; unknown values are dropped; anything that is not an array → `invalid` |
| `brands` | no | integer 1–50 (how many brands / menus the restaurant runs) |
| `message` | no | ≤ 2000 |
| `lang` | no | `fr` (default) or `en`: the language of the auto-reply |
| `source` | no | ≤ 40, default `on2go.ca` |
| `company` | honeypot | hidden field, must stay empty. Any value → `202 { "ok": true }` and the submission is dropped silently |

Control characters are stripped from every text field, line breaks from every field but `message` (one line per email
header, one line in the console), and the three quoted fields (`restaurant`, `contact`, `city`) refuse anything that
looks like a link: the auto-reply repeats them, and a form that sends attacker text to any address would be a spam relay.
Nothing is ever HTML-rendered from the request.

## Answers

| Status | Body | When |
|---|---|---|
| `202` | `{ "ok": true }` | stored (or honeypot: dropped, same answer) |
| `400` | `{ "ok": false, "errors": { "<field>": "required" \| "invalid" \| "too_long" } }` | validation; `{ "body": "invalid" }` for malformed JSON |
| `413` | `{ "ok": false, "error": "Too large." }` | body over 16 000 bytes |
| `415` | `{ "ok": false, "error": "…" }` | `Content-Type` is not `application/json` |
| `429` | `{ "ok": false, "error": "Too many requests…" }` + `Retry-After` | quota spent for this IP |

Every answer carries `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` and, for an allowed origin,
`Access-Control-Allow-Origin` + `Vary: Origin`.

## Form on on2go.ca (static site)

```html
<form id="join">
  <!-- visible fields: restaurant, contact, email, phone, city, address, website, platforms[], brands, message -->
  <input name="company" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px">
</form>
<script>
document.getElementById('join').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const body = Object.fromEntries(f.entries());
  body.platforms = f.getAll('platforms');
  body.lang = document.documentElement.lang.startsWith('en') ? 'en' : 'fr';
  body.source = 'on2go.ca';
  const res = await fetch('https://<food-hub-host>/api/public/restaurant-leads', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json();
  // 202 → thank-you message; 400 → show data.errors per field; 429 → ask to retry in a few minutes
});
</script>
```

## What is stored (console shape)

```json
{
  "id": "uuid", "at": "2026-10-21T14:03:00.000Z",
  "restaurant": "Chez Mimi", "contact": "Mimi Tremblay", "email": "mimi@example.com", "phone": "+15145550199",
  "city": "Montréal", "address": "123 rue Test", "website": "https://chezmimi.example",
  "platforms": ["uber", "direct"], "brands": 2, "message": "…", "lang": "fr", "source": "on2go.ca",
  "status": "new", "notes": "", "updatedAt": "2026-10-21T14:03:00.000Z", "updatedBy": "owner"
}
```

`POST /api/foodhub/restaurant-leads` with `{ "id", "status"?, "notes"? }` (owner) moves the status or saves the note; a
status change is written to the activity log. Leads are never deleted from the console: mark them `lost`.

## Environment

| Variable | Role |
|---|---|
| `FOODHUB_SUPPORT_EMAIL` | where the notification goes (the Settings page warns when it is missing) |
| `SMTP_*` or `RESEND_API_KEY` + from address | the usual email sender (see `docs/DEPLOYMENT.md`) |
| `FOODHUB_TRUST_PROXY=true` | behind Coolify / Traefik / nginx, so the quota is per real client IP |
