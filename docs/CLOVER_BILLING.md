# Clover billing for TAKATAK Food Hub

Owner's pricing (decided 2026-10-16, already set in the Clover developer dashboard for the Food Hub app):

| What | Price | Who runs it |
|---|---|---|
| Subscription tier **Standard** | CAD $50/month, Canada only | Clover |
| Free trial | 14 days | Clover |
| Metered event **Extra brand, per platform, per month** | CAD $15 per unit | Food Hub counts, Clover bills |

The first brand is included in the $50. Each **additional** brand costs $15 for each delivery platform it is connected
to (Uber Eats, DoorDash, SkipTheDishes). Example: a second brand on all three platforms = 3 units = $45/month.

Listing sentence (one source: `PRICING_STATEMENT` in `lib/foodhub/pos/clover-pricing.ts`):

- FR: « Essai gratuit de 14 jours, puis 50 $/mois par app, + 15 $ par marque supplémentaire par plateforme, facturé
  par Clover. »
- EN: "14-day free trial, then $50/month per app, + $15 per extra brand per platform, billed by Clover."

Clover bills the merchant. Food Hub never charges anyone outside Clover.

## What Food Hub does

Code: `lib/foodhub/pos/clover-extra-brands.ts`. Tests: `tests/clover-billing.test.ts` (Clover is always mocked).

1. **Subscription status.** For each merchant that installed the app, Food Hub reads Clover's `billing_info` (tier,
   trial, ACTIVE / LAPSED) and keeps it 15 minutes. Settings → App Clover → **Facturation Clover** shows it in plain
   words: « Essai gratuit : 9 jours restants », « Forfait Standard 50 $/mois », « Paiement Clover en retard ». When
   Clover does not give the trial end, the days left are estimated from the install date (shown as « environ »).
2. **Counting extra brands.** From Food Hub's store mappings (Stores → Mapping), per Clover merchant:
   - a brand counts when it has at least one store connected on Uber Eats, DoorDash or SkipTheDishes;
   - the **first brand** is free: the one marked « Marque principale » in Settings → App Clover, otherwise the
     oldest (its first store mapped earliest);
   - each other brand = one unit per platform it is on (two locations on the same platform = still one unit);
   - Too Good To Go is never counted; a brand deactivated in Business setup is not counted;
   - a store with no Clover merchant of its own follows the default merchant, like orders do.
3. **Monthly report to Clover** (OFF by default). Each run (the sync, at most once an hour, or
   `/api/foodhub/cron/clover-billing`) keeps this month's **highest** count seen while the subscription was **paid**
   (ACTIVE, not in the free trial, on the **Standard** tier). During the next month, that count is sent **once**:
   `POST /v3/apps/{appId}/merchants/{merchantId}/metereds/{meteredId}?count=N`.
   - Only the Standard tier pays for extra brands. With `CLOVER_FOODHUB_STANDARD_PLAN_IDS` set, the Clover
     subscription ID decides; otherwise the tier name must say "Standard" and its price must not be $0. Any other tier
     (an old $0 tier, for example) shows « Non facturé : forfait X » in the dry run and is never counted.
   - Idempotent per merchant and month: each try is first claimed with one atomic database write (two containers
     during a deploy can never both send it), then the month is saved as "sending", then "reported".
   - Only an answer that shows Clover did not take it is tried again on later runs: a 4xx (429 included) or no
     connection at all. 3 tries in all, then "given up" (shown in the log).
   - A timeout, a connection that broke after sending, a 5xx or a 408, and a run stopped mid-send are "uncertain":
     never sent again by itself. Check the charge in the Clover dashboard.
   - A run that cannot read the brands (Business setup) or the « Marque principale » marks records no count for that
     run (never a count from defaults); last month's report still goes out from its saved record.
   - The month keeps its highest count: removing a brand or changing « Marque principale » lowers the bill from the
     next month (the section says so under the selector).
   - Count 0 = nothing sent. Exempt merchants (`FOODHUB_BILLING_EXEMPT_MERCHANTS` and `PHONE_OWN_MERCHANTS`) are never
     counted or sent.
   - A month is only sent during the month right after it.
4. **Dry run.** Settings → App Clover → Facturation Clover shows, for each merchant, the brands, the count, this
   month's amount, and exactly the request that would be sent for last month (or why nothing would be sent). Loading
   the page never writes or sends anything. The **billing log** lists every count change, report, refusal and skip.
5. **Price before confirming.** « Ajouter une marque » (Settings → Business) and connecting a platform store
   (Stores → Mapping, Uber activation) show « +15 $/mois pour cette plateforme » and ask to confirm, only for an
   extra brand of a merchant that installed the app and is not exempt. Nothing is shown for the first brand or for
   our own restaurants. An Uber activation of several stores is quoted once with all of them added together
   (« +30 $/mois : 2 marques sur Uber Eats »). A new brand in Business setup is not tied to a merchant yet, so its
   notice is worded as a condition (« Si ce n’est pas la première marque de votre marchand Clover … »).

## Owner steps (environment names only, values in Coolify)

1. In the Clover developer dashboard → Food Hub app → Pricing → Metered: copy the ID of "Extra brand, per platform,
   per month".
2. In Coolify, set:
   - `CLOVER_METERED_EXTRA_BRAND_ID` = that ID;
   - `FOODHUB_BILLING_EXEMPT_MERCHANTS` = our own restaurants' Clover merchant IDs, comma-separated (never billed;
     the IDs already in `PHONE_OWN_MERCHANTS` are exempt too);
   - `CLOVER_FOODHUB_STANDARD_PLAN_IDS` = the Clover subscription ID of the Standard tier (recommended; without it
     the tier name "Standard" is used);
   - leave `FOODHUB_CLOVER_METERED_ENABLED` empty for now.
3. Deploy, then open Settings → App Clover → **Facturation Clover**. Check the dry run: the right first brand per
   merchant, our own restaurants shown as « Exempté », the units and amounts you expect. Change « Marque principale »
   where needed.
4. When the dry run is right, set `FOODHUB_CLOVER_METERED_ENABLED=true` and redeploy. The first real report goes out
   during the month after the first paid month.
5. Once a month, glance at the billing log. Any « Incertain » or « Abandonné » line: check the merchant's charges in
   the Clover dashboard before doing anything else.

Optional: a scheduler can call `GET /api/foodhub/cron/clover-billing` with `Authorization: Bearer <CRON_SECRET>`.
The sync already runs it at most once an hour, so this is not needed.
