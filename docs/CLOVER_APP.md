# Clover app "TAKATAK Food Hub" — how it works

Submission checklist and owner steps: [`CLOVER_MARKETPLACE_LAUNCH.md`](CLOVER_MARKETPLACE_LAUNCH.md). Texts to paste:
[`CLOVER_APP_LISTING.md`](CLOVER_APP_LISTING.md). Live checks and Copy buttons: Food Hub → **Settings → Clover app**.

Developer account details (login, developer ID) are kept in the owner's private notes, not in this public repository.

## App settings

| Field | Value |
|---|---|
| App ID | `629HFYHNVMZYR` → `CLOVER_CLIENT_ID` |
| App Secret | developer dashboard → App Settings (eye icon) → `CLOVER_CLIENT_SECRET`. Server only, never in chat. |
| App type | REST Clients → Web · App Market: yes · POS integration: no · Canada + United States |
| Permissions | Read + Write: Merchant, Inventory, Orders, Payments. Reasons are in `CLOVER_APP_LISTING.md`. |
| Site URL | `https://YOUR-DOMAIN`, the value of `FOODHUB_PUBLIC_URL`. Live: `https://foodhub.on2go.ca` (switch tracked in task 5 of `docs/PROGRESS.md`). The temporary sslip.io address must be replaced **before** submitting, because a Site URL change after approval goes back to Clover's review. |
| Alternate Launch Path | `/api/foodhub/clover-connect/callback` |
| Default OAuth response | `CODE` |
| Webhook URL | `https://YOUR-DOMAIN/api/foodhub/webhooks/clover`. Clover sends a verification code; Food Hub shows it in Settings → Platforms & Clover. |
| Webhook events | **Inventory**, **App** (install, uninstall, subscription change) |

## How a merchant connects

1. **From Clover.** The merchant installs or opens the app, and Clover sends the browser to the launch path:
   - **With a code** (Default OAuth response = CODE): Food Hub exchanges it, with the App Secret, for an access token
     and a refresh token (OAuth v2, expiring tokens).
   - **Without a code** (dashboard left navigation, App Market install): Food Hub sends the browser to Clover's
     `/oauth/v2/authorize` once, with a signed launch state. Clover comes back with the code.
   - At that moment Food Hub reads (never writes) the merchant's profile, a count of its items, categories, order
     types, tenders and devices, and its App Market subscription (`billing_info`).
   - Then it opens the public welcome page `/welcome/clover?t=<signed ticket>`.
2. **Who gets connected:**
   - Your own merchants are connected at once. Food Hub recognises them by `CLOVER_MERCHANT_ID`,
     `CLOVER_MERCHANT_TOKENS`, `CLOVER_ALLOWED_MERCHANTS`, or a store mapped to the merchant.
   - Any other merchant is **Pending**. Its tokens are kept but never used: no orders, no sync, nothing written to
     its Clover. It stays that way until the owner clicks **Approve** in Settings → Platforms & Clover, or
     **Decline** to remove it.
   - The owner is alerted once, by team chat (`ALERT_WEBHOOK_URL`) and email (`FOODHUB_OWNER_EMAIL`).
3. **The welcome page** (French and English, language switch):
   - the merchant's status;
   - the read-only register check;
   - the 3 set-up steps (platforms, Clover menu, kitchen tablet and PIN), live when an owner or manager is signed in;
   - for approved merchants, **Send a test order**. It creates a TEST order in their Clover with the platform order
     type, prints it, and pays it for Clover's own total with the platform tender. It never enters Food Hub. Limit:
     3 per hour.
   - The ticket is valid 7 days. Without it, the page shows no merchant data.
4. **From Food Hub:** Settings → Platforms & Clover → **Connect a Clover merchant**. These connections are approved at
   once, because the owner started them.
5. **Tokens:**
   - They renew automatically 5 minutes before they expire. Every Clover call backs off on a 429.
   - Uninstalling the app (webhook `A:<appId>` DELETE) removes them. An App `UPDATE` re-reads the subscription.
   - API tokens in `CLOVER_ACCESS_TOKEN` / `CLOVER_MERCHANT_TOKENS` still work and take priority.

## Platforms linked to Clover directly (Clover → Online ordering → Partners)

When DoorDash or Uber Eats is linked to Clover through Clover's own integration, the platform creates its orders in
Clover itself, and Food Hub never receives them by webhook.

At each sync, Food Hub reads the new Clover orders and adds the ones a platform created as **read-only "via Clover"**
orders. It recognises them by order type, payment tender, title or note ("DoorDash", "Uber Eats", "SkipTheDishes",
"Too Good To Go"). These orders:
- appear in the Command Center, order history, analytics, payout checks and reports;
- are never counted as in-store sales;
- are never accepted, rejected, cancelled or re-sent to Clover by Food Hub, and Food Hub records no Clover payment for
  them. The kitchen can only mark them Ready / Completed on its own screen and reprint the ticket.

Other rules:
- Orders Food Hub created itself are never read back. They are recognised by their known Clover ids and by
  "<platform> #<order>" titles; test orders are titled `Uber Eats #TEST-…`.
- An order is read once it is 2 minutes old. The first run looks back 24 hours.
- Turn this off with `FOODHUB_CLOVER_PLATFORM_ORDERS=off`.

Set `FOODHUB_VIA_CLOVER=doordash` (with `npm run setup`) when DoorDash is linked this way:
- Settings → Platforms shows DoorDash as **Linked through Clover**, and the go-live step is green.
- Every action that would need DoorDash's own API (menu publish, 86, pause, accept/reject) is refused with "do it in
  Clover or the DoorDash portal". It is never shown as done.
- Menu, prices (the +20 % DoorDash menu) and sold-out items for DoorDash are managed in Clover.
