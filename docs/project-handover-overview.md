# Project Handover Overview

This document is the top-level handover index for the current repository state.

Use it as the first entry point when onboarding a new engineer, preparing a release, or investigating a production issue.

## 1. Core Areas

### Frontend Wallet Integration

- Implementation:
  - [apps/web/src/lib/neoline.ts](/Users/jinghuiliao/git/NFT/apps/web/src/lib/neoline.ts)
  - [apps/web/src/hooks/useWallet.tsx](/Users/jinghuiliao/git/NFT/apps/web/src/hooks/useWallet.tsx)
- Main document:
  - [docs/neoline-frontend-integration.md](/Users/jinghuiliao/git/NFT/docs/neoline-frontend-integration.md)

### Production Config / Deployment

- Vercel config:
  - [vercel.json](/Users/jinghuiliao/git/NFT/vercel.json)
- API config:
  - [apps/api/src/config.ts](/Users/jinghuiliao/git/NFT/apps/api/src/config.ts)
  - [api/index.ts](/Users/jinghuiliao/git/NFT/api/index.ts)
- Main document:
  - [docs/production-config-audit.md](/Users/jinghuiliao/git/NFT/docs/production-config-audit.md)

### Security / Secret Rotation

- Runbook:
  - [docs/security-secrets-incident-response.md](/Users/jinghuiliao/git/NFT/docs/security-secrets-incident-response.md)

### Release Validation

- Checklist:
  - [docs/wallet-release-checklist.md](/Users/jinghuiliao/git/NFT/docs/wallet-release-checklist.md)

## 2. Most Important Commands

### Local Quality Gates

```bash
npm run check
npm run build
npm run smoke:e2e
npm run smoke:trade
```

### Wallet Regression

Requires `NEO_TEST_WIF`:

```bash
NEO_TEST_WIF=... npm run test:wif-ui
```

### Production Config Audit

```bash
npm run audit:production-config
```

### Repository Security Surface Audit

```bash
npm run audit:security
```

### Runtime Contract Interface Audit

```bash
npm run audit:runtime-contracts
```

### Contract Validation

```bash
npm run verify:contracts
```

## 3. GitHub Actions

Manual workflow:

- [Production Audit workflow](/Users/jinghuiliao/git/NFT/.github/workflows/production-audit.yml)

It can run:

- production config audit
- runtime contract audit
- typecheck
- build
- API smoke
- trade smoke
- optional real wallet UI regression if `NEO_TEST_WIF` is configured in GitHub Secrets

## 4. Environment Variables

Reference template:

- [.env.example](/Users/jinghuiliao/git/NFT/.env.example)

High-level rules:

### Server-only

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_SECRET_KEY`
- `SUPABASE_KEY`
- `POSTGRES_*`
- `NEO_*` server-side network settings

### Client-safe

- `VITE_API_BASE_URL*`
- `VITE_NEO_RPC_URL*`
- `VITE_NEO_CONTRACT_HASH*`
- `VITE_CONTRACT_DIALECT`
- `VITE_WALLET_DEBUG` only when intentionally debugging

## 5. Current Deployment Defaults

### Node

- pinned to `20.x` in [package.json](/Users/jinghuiliao/git/NFT/package.json)

### Vercel Cron

Configured in [vercel.json](/Users/jinghuiliao/git/NFT/vercel.json):

- `/api/sync?network=testnet`
- `/api/sync?network=mainnet`

### Wallet Debug

- disabled in production by default
- enabled only for:
  - development mode
  - or `VITE_WALLET_DEBUG=true`

## 6. Known Operational Decisions

1. Wallet state is persisted and reused across page navigation and reload.
2. Silent wallet sync must never trigger interactive connect prompts.
3. API Supabase config now uses server-side variables only.
4. CORS no longer defaults to wildcard.
5. Wallet regression testing is available as a dedicated WIF-driven browser flow.

## 7. Suggested Release Routine

Before releasing:

1. Run:

```bash
npm run audit:production-config
npm run check
npm run build
npm run smoke:e2e
npm run smoke:trade
```

2. If wallet behavior changed:

```bash
NEO_TEST_WIF=... npm run test:wif-ui
```

3. Review:
   - [docs/wallet-release-checklist.md](/Users/jinghuiliao/git/NFT/docs/wallet-release-checklist.md)
   - [docs/production-config-audit.md](/Users/jinghuiliao/git/NFT/docs/production-config-audit.md)

## 8. Suggested Incident Routine

If a secret leaks or production config is suspected:

1. Read:
   - [docs/security-secrets-incident-response.md](/Users/jinghuiliao/git/NFT/docs/security-secrets-incident-response.md)
2. Rotate exposed credentials
3. Redeploy
4. Re-run:

```bash
npm run audit:production-config
npm run check
npm run build
npm run smoke:e2e
npm run smoke:trade
```
