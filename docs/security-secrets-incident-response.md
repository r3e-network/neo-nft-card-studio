# Security Secrets Incident Response

This document is the operational runbook for handling leaked credentials, rotating secrets, and validating recovery for this project.

Related files:

- [docs/production-config-audit.md](/Users/jinghuiliao/git/NFT/docs/production-config-audit.md)
- [docs/wallet-release-checklist.md](/Users/jinghuiliao/git/NFT/docs/wallet-release-checklist.md)
- [.env.example](/Users/jinghuiliao/git/NFT/.env.example)
- [scripts/audit-production-config.mjs](/Users/jinghuiliao/git/NFT/scripts/audit-production-config.mjs)
- [.github/workflows/production-audit.yml](/Users/jinghuiliao/git/NFT/.github/workflows/production-audit.yml)

## 1. Secret Inventory

Treat these as sensitive and rotate them if they are exposed outside the intended secret store.

### 1.1 Supabase Server Secrets

- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_SECRET_KEY`
- `SUPABASE_KEY`
- `SUPABASE_JWT_SECRET`
- `POSTGRES_PASSWORD`
- `POSTGRES_URL`
- `POSTGRES_URL_NON_POOLING`
- `POSTGRES_PRISMA_URL`

### 1.2 Wallet / Chain Test Secrets

- `NEO_TEST_WIF`
- `TESTNET_WIF`
- `TESTNET_BUYER_WIF`

### 1.3 CI / Platform Secrets

- GitHub Actions repository secrets
- Vercel project environment variables

## 2. Immediate Incident Response

Run these steps in order when a secret is leaked into chat, logs, screenshots, issue trackers, CI output, or source control.

### 2.1 Contain

1. Stop copying the leaked value into additional systems.
2. Remove the value from any pending commits, PR descriptions, issue comments, or documentation drafts.
3. Disable any active debugging flag that would continue printing sensitive context.

### 2.2 Rotate

For Supabase credential exposure, rotate at minimum:

1. `SUPABASE_SERVICE_ROLE_KEY`
2. `SUPABASE_SECRET_KEY` if used
3. `POSTGRES_PASSWORD`
4. `SUPABASE_JWT_SECRET` if the JWT signing secret was exposed

For wallet/testnet credential exposure, rotate:

1. `NEO_TEST_WIF`
2. any related testnet funding account WIF

### 2.3 Update Secret Stores

Update all secret stores where the leaked secret may still exist:

1. Vercel project environment variables
2. GitHub Actions secrets
3. local untracked `.env*` files used by the team
4. password managers / vault entries

### 2.4 Redeploy

After rotating and updating secrets:

1. redeploy Vercel
2. manually trigger the [Production Audit workflow](/Users/jinghuiliao/git/NFT/.github/workflows/production-audit.yml)
3. rerun:

```bash
npm run audit:production-config
npm run check
npm run build
npm run smoke:e2e
npm run smoke:trade
```

If wallet regression coverage is required:

```bash
NEO_TEST_WIF=... npm run test:wif-ui
```

## 3. Supabase Rotation Procedure

Use this when Supabase-related secrets are exposed.

### 3.1 Rotate Server Credentials

Rotate in Supabase dashboard / SQL / platform tooling as appropriate:

1. service-role key
2. secret key if used
3. database password
4. JWT secret if exposed

Important:

- rotating the JWT secret can invalidate existing tokens and may require broader downstream coordination
- rotating database password requires updating all database connection strings

### 3.2 Update This Project

Update only server-side production env with:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- optional `SUPABASE_SECRET_KEY` if you intentionally use it

Do not place any server secret into:

- `VITE_*`
- `NEXT_PUBLIC_*`

### 3.3 Verify

1. Vercel deploy succeeds
2. `/api/health` returns `ok`
3. Supabase-backed API reads work
4. `node scripts/audit-production-config.mjs` shows no warnings

## 4. Wallet / Testnet WIF Rotation Procedure

Use this when a test wallet WIF is exposed.

1. Stop using the exposed WIF immediately.
2. Move any remaining funds or assets out of the old account.
3. Generate a fresh wallet.
4. Fund the new account as needed for smoke tests.
5. Update:
   - local untracked `.env*`
   - GitHub Actions `NEO_TEST_WIF`
   - any developer documentation that references the old operational account
6. Rerun `npm run test:wif-ui`

## 5. Vercel Secret Hygiene

Production rules:

1. Keep client-safe values and server secrets separate.
2. Leave `VITE_WALLET_DEBUG` unset by default.
3. Set `API_CORS_ORIGIN` to an explicit allowlist in production.
4. Keep only required Supabase server credentials in Vercel env.

Recommended production checks:

```bash
npm run audit:production-config
```

And in Vercel:

1. confirm the deployed commit is the intended one
2. confirm environment variables are present in the correct environment scope
3. confirm mainnet/testnet cron coverage matches operational intent

## 6. GitHub Actions Secret Hygiene

If GitHub Actions secrets are used:

1. keep `NEO_TEST_WIF` only in repository or environment secrets
2. do not print secrets in workflow logs
3. prefer manual `workflow_dispatch` for wallet-enabled workflows
4. rotate GitHub secrets immediately after any exposure event

## 7. Repository Hygiene Rules

Never commit:

- `.env`
- `.env.local`
- `.env.testnet`
- `.env.vercel.*`
- funded WIFs
- service-role keys
- database passwords

Current repository protections:

- `.gitignore` already excludes `.env*` except examples
- wallet debug logs are gated behind `DEV` or `VITE_WALLET_DEBUG=true`
- helper scripts require secrets from environment instead of hardcoding them

## 8. Post-Incident Validation Checklist

After rotation is complete, verify:

1. old credentials no longer work
2. Vercel deploy uses only the new credentials
3. API health is green
4. wallet flow still works
5. audit script returns no warnings
6. no secret remains in tracked files

Recommended spot checks:

```bash
git ls-files .env .env.local .env.testnet .env.vercel.production .env.vercel.runtime
rg -n "SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|POSTGRES_PASSWORD|NEO_TEST_WIF|TESTNET_WIF" . -S
```

## 9. Decision Rules

Use these rules to reduce confusion during incident handling.

1. If a secret appeared in a public or shared place, rotate it. Do not just delete the message and assume safety.
2. If a secret was used in client-visible env, treat it as exposed.
3. If a wallet WIF was pasted into chat, rotate it even if the funds appear untouched.
4. If JWT signing material was exposed, treat all derived tokens as compromised.

## 10. Minimal Recovery Summary

If you need the shortest possible version:

1. rotate leaked secret
2. update Vercel + GitHub + local env stores
3. redeploy
4. run:

```bash
npm run audit:production-config
npm run check
npm run build
npm run smoke:e2e
npm run smoke:trade
```

5. if wallet flow matters:

```bash
NEO_TEST_WIF=... npm run test:wif-ui
```
