# Security

TAKATAK Food Hub handles live orders and payout money for Quadro Holdings LTEE. Please report a
suspected vulnerability privately to the repository owner (GitHub: @takatakca) instead of opening a
public issue.

## Rules the code enforces

- **Secrets never leave the environment.** Keys are entered with `npm run setup` (writes `.env.local`)
  or as hosting environment variables. The console never prints a secret; Settings → Go-live and Settings → Channels
  only report which keys are present ("Show secrets" reveals only the webhook tokens you must give the platforms).
- **No live call without the owner's switch.** Nothing is sent to Uber Eats, DoorDash, SkipTheDishes,
  Too Good To Go or Clover until `LIVE_CONNECTORS_GLOBAL_ENABLED=true`. Read-only status polls and the
  owner-initiated Uber OAuth exchange are the documented exceptions (see `docs/LOCKED_DECISIONS.md`).
- **A live dashboard is never open.** With live connectors on, `DASHBOARD_PASSWORD` is mandatory; the
  proxy refuses to serve the app otherwise. Sessions are signed (HMAC-SHA256) and revoked on password
  change or user deactivation; sign-in attempts are throttled per client and per user.
- **Passwordless sign-in and PINs are rate-limited.** One-time codes expire after 10 minutes (5 tries, 5 requests
  per 15 minutes per contact; unknown contacts get the same answer). Staff PINs are hashed (scrypt), unique, never
  trivial; 5 wrong PINs lock that tablet / person for 5 minutes. A removed kitchen tablet is signed out at once.
- **Webhooks are verified.** Uber Eats (HMAC-SHA256), DoorDash (shared secret), SkipTheDishes / JET
  Connect (HMAC) and Too Good To Go (token) deliveries are checked before anything is stored; anything
  unparseable is kept under *Channels → Unparsed payloads*, never dropped.
- **Dependencies are gated.** CI fails when a production dependency carries a high or critical
  advisory (`npm audit --omit=dev --audit-level=high`). Dev-only tooling advisories are reported weekly.

## Supported versions

Only the latest release on `main` is supported.
