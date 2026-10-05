# Clover app "TAKATAK Food Hub" — App Market setup (RC10.3)

Developer account: takatak.ca@gmail.com (developer 9KJ25ATT15TTW). App created Oct 5, 2026.

| Field | Value |
|---|---|
| App ID | `629HFYHNVMZYR` → `CLOVER_CLIENT_ID` |
| App Secret | developer dashboard → App Settings (eye icon) → `CLOVER_CLIENT_SECRET` (server only, never in chat) |
| App type | REST Clients → Web · App Market: yes · POS integration: no · Canada + United States |
| Permissions | Read + Write: Inventory, Merchant, Orders, Payments (reasons filled in) |
| Site URL | `https://31-220-96-134.sslip.io` (change to `https://foodhub.takatak.ca` once DNS points to the VPS — Clover reviews Site URL changes) |
| Alternate Launch Path | `/api/foodhub/clover-connect/callback` |
| Default OAuth response | CODE |
| Webhook URL | `https://31-220-96-134.sslip.io/api/foodhub/webhooks/clover` — set it **after** the server is running (Clover sends a verification code; Food Hub shows it in Settings → Platforms & Clover) |
| Webhook events | Inventory, App |

## How a merchant connects
1. From Clover: the merchant installs / opens the app → Clover opens the launch path with a code → Food Hub exchanges it (with the App Secret) for an access + refresh token and stores them per merchant, then shows a public welcome page (`/welcome/clover`).
   - Your own merchants (`CLOVER_MERCHANT_ID`, `CLOVER_MERCHANT_TOKENS`, `CLOVER_ALLOWED_MERCHANTS`, or a store mapped to the merchant) are connected at once.
   - Any other merchant is **Pending**: its tokens are kept but never used (no orders, no sync) until the owner clicks **Approve** in Settings → Platforms & Clover (or **Decline** to remove it).
2. From Food Hub: Settings → Platforms & Clover → **Connect a Clover merchant** (approved at once — the owner started it).
3. Tokens renew automatically 5 minutes before they expire. Uninstalling the app (webhook `A:<appId>` DELETE) removes them.
4. API tokens in `CLOVER_ACCESS_TOKEN` / `CLOVER_MERCHANT_TOKENS` still work and take priority.

## Before submitting to the App Market
- Server installed and reachable at the Site URL; webhook URL verified; `CLOVER_WEBHOOK_AUTH` set.
- Test on a **sandbox** developer account (sandbox.dev.clover.com) with a test merchant: install → order arrives → paid with platform tender → uninstall.
- Market listing: everything is ready in `docs/CLOVER_APP_LISTING.md` (tagline, benefits, description FR + EN, categories, permissions) plus the icon and 16 screenshots in the owner's `takatak-clover-listing` folder.
- Legal pages (public, French first): `/legal/privacy`, `/legal/terms` (EULA), `/legal/support`. Drafts until reviewed — set `FOODHUB_SUPPORT_EMAIL` and then `FOODHUB_LEGAL_APPROVED=true`.
- Submit App (top right in App Settings). Clover review usually takes a few business days.

## Platforms linked to Clover directly (Clover → Online ordering → Partners)
When DoorDash (or Uber Eats) is linked to Clover by Clover's own integration, the platform creates its orders in
Clover itself and Food Hub never receives them by webhook. Each sync, Food Hub reads the new Clover orders and adds
the ones a platform created (recognised by the order type, payment tender, title or note — "DoorDash", "Uber Eats",
"SkipTheDishes", "Too Good To Go") as **read-only "via Clover"** orders:
- they appear in the Command Center, order history, analytics, payout checks and reports;
- they are never counted as in-store sales;
- Food Hub never accepts, rejects, cancels, re-sends them to Clover or records a Clover payment for them — the
  kitchen can only mark them Ready / Completed on its own screen and reprint the ticket;
- orders Food Hub created itself are never read back (known Clover ids, and "<platform> #<order>" titles);
- an order is read once it is 2 minutes old; first run looks back 24 hours. Turn off with
  `FOODHUB_CLOVER_PLATFORM_ORDERS=off`.

Set `FOODHUB_VIA_CLOVER=doordash` (with `npm run setup`) when DoorDash is linked this way: Settings → Platforms shows
DoorDash as **Linked through Clover**, the go-live step is green, and every action that would need DoorDash's own API
(menu publish, 86, pause, accept/reject) is refused with "do it in Clover or the DoorDash portal" — never shown as
done. Menu, prices (the +20 % DoorDash menu) and sold-out items for DoorDash are managed in Clover.
