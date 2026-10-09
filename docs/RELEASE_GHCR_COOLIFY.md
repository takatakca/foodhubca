# Food Hub — GHCR release and Coolify cutover (2026-10-09)

## Verified release facts

- PR #30 (ON2GO phone menu) merged as `df9adb4263b29f3993d339b494ff52711b354ac3`.
- Both `main` runs passed: CI `37931778873`, image publish `37931778864`.
- Image published: `ghcr.io/takatakca/foodhubca:main` and `ghcr.io/takatakca/foodhubca:sha-df9adb4`.
- Image workflow's attempt to change package visibility returned **HTTP 404** at 2026-10-09 12:45 UTC. Its prior success only proved image publish, not anonymous pull.
- The repository is public, but GHCR package visibility is configured independently. Deployment on Coolify is **not verified**.

## One owner-controlled registry decision

### Option A — public GHCR image (simplest, but irreversible visibility change)

1. Sign into GitHub as `takatakca` → profile → **Packages** → **foodhubca** → **Package settings**.
2. Under **Danger Zone**, choose **Change visibility** → **Public** and confirm. **GitHub's package docs warn that making a package public may not be reversible.**
3. On a clean client with no GHCR login, verify `docker manifest inspect ghcr.io/takatakca/foodhubca:sha-df9adb4`. Do not confuse a successful push with an anonymous pull.

### Option B — keep GHCR image private (preserves confidentiality)

1. Create a GitHub package read-only credential with `read:packages` through the owner's GitHub account.
2. Configure GHCR credentials in Coolify's registry authentication for every server that will pull the package.
3. Test a pull from Coolify before cutover. Never send any token in chat, a PR, or a repository file.
4. For this option, the anonymous-access CI gate in `.github/workflows/image.yml` must be made conditional or replaced with a private-auth pull validation prior to merging the workflow change.

## Coolify deployment — protect the current working service

1. In Coolify → project FOOD HUB → `foodhubca`, record the existing deployment ID, image/source revision, domains, env *names*, health checks, networks, restart policy, and persistent volume mount. Keep the rollback revision; do not display secret values.
2. **Do not delete or overwrite the running resource.** A Git/Dockerfile-sourced Coolify app may require a separate Docker Image resource rather than an in-place change of build type.
3. Configure a **new** Docker Image resource using `ghcr.io/takatakca/foodhubca` with tag `sha-df9adb4` (preferred pinned release; `main` is a mutable tag) and exposed port **3000**.
4. Start with a protected preview domain; set `FOODHUB_PUBLIC_URL` to its intended origin for that environment, `FOODHUB_TRUST_PROXY=true`, `FOODHUB_INTERNAL_SYNC_MIN=0`, and `LIVE_CONNECTORS_GLOBAL_ENABLED=false` during isolated smoke tests. Use appropriate staging credentials and never point public test traffic at live payment/order endpoints.
5. Configure `SESSION_SECRET`, database and other necessary runtime variables securely in Coolify. **Do not overwrite the original value of `SESSION_SECRET`** for the existing production app.
6. Bind a persistent storage mount for `/app/data/media`. Back up current uploaded files, configuration, and database before any cutover. A newly created empty volume does not contain the old images.
7. Smoke test `GET /api/health`, `/login`, `/settings/go-live`, the ON2GO phone menu, menu/brand directory and kitchen tablet. Confirm logs show the pinned release. A `503` health result is not production success even if the CI smoke test allows it for its database-free container.
8. Plan a controlled cutover. Only **one** production instance may process inbound webhooks, periodic sync, and orders at a time; prevent duplicate Clover tickets and platform orders. Move the production domain only after the new resource is verified, and make sure webhooks point to the final domain.
9. Verify HTTPS, user sign-in, configured integrations and a test order all the way to Clover printer and kitchen tablet. Test IVR calls, handoff, voicemail and brand routing separately. Keep external platform live connectors off until each has a passing end-to-end order, and keep tablet fallback enabled.
10. If a cutover check fails, restore the previous production app and domain; check that webhook receivers and scheduled sync are not running simultaneously. For image rollback use the **known running digest/tag**, never assume an older commit tag equals the currently deployed app.

## Automation follow-up

- Build and publish from GitHub is already automated. The workflow does **not** deploy to Coolify.
- After the initial cutover, configure Coolify's deploy webhook/API behind a GitHub Actions encrypted secret, with read-only verification of the deployed release. Trigger deployment only on successful `main` image publication plus appropriate registry pull verification.
- Do not put a Coolify token or webhook URL containing a token in source control, PR text, or agent chat.
- Owner actions left: grant GitHub package visibility or Coolify registry auth, connect Coolify access, approve production cutover, supply account approvals/keys only through secure destination UIs.

## External dependencies still outstanding

- Clover verified webhook and merchant grant, partner app listing approval, Twilio voice webhook, SMTP, Uber/DoorDash/Skip commercial API authorizations, and per-store test orders are separate from this image deployment.
- This runbook does not turn `LIVE_CONNECTORS_GLOBAL_ENABLED=true` or certify any production payment/order integrations.
