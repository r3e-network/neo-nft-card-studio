# Production Config Audit

This document records the current production configuration audit for Vercel, Supabase, and wallet debugging.

Audit scope:

- [vercel.json](/Users/jinghuiliao/git/NFT/vercel.json)
- [package.json](/Users/jinghuiliao/git/NFT/package.json)
- [.env.example](/Users/jinghuiliao/git/NFT/.env.example)
- [apps/api/src/config.ts](/Users/jinghuiliao/git/NFT/apps/api/src/config.ts)
- [api/index.ts](/Users/jinghuiliao/git/NFT/api/index.ts)
- [apps/web/src/lib/config.ts](/Users/jinghuiliao/git/NFT/apps/web/src/lib/config.ts)
- [apps/web/src/lib/neoline.ts](/Users/jinghuiliao/git/NFT/apps/web/src/lib/neoline.ts)

## 1. Vercel Audit

### Current State

- Build command is `npm run vercel-build`
- Output directory is `apps/web/dist`
- API requests are rewritten to `/api/index.ts`
- Vercel crons are configured for:
  - `/api/sync?network=testnet`
  - `/api/sync?network=mainnet`
- `package.json` pins Node with `"engines": { "node": "20.x" }`

### Conclusions

- Vercel project-level Node version settings will be ignored because `package.json` pins Node 20.x.
- The current web output path is consistent with the Vite build output.
- The root `dist/` copy performed in `vercel-build` is still useful for the API workspace Vercel build path, but Vercel static output remains `apps/web/dist`.
- Production indexing now includes both testnet and mainnet cron coverage.

### Recommendations

1. Leave Node pinned to `20.x` unless you intentionally test and migrate the entire repo.
2. Keep `outputDirectory` as `apps/web/dist`.
3. Add a private-network cron only if you actually run a private deployment that needs scheduled indexing.
4. Keep the Vercel CLI out of project dependencies unless you intentionally want it installed with the app dependencies.

## 2. Supabase Audit

### Server-Side Variables That Should Be Set In Production

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Additional server variables as needed:

- `NEO_DEFAULT_NETWORK`
- `NEO_RPC_URL*`
- `NEO_CONTRACT_HASH*`
- `NEO_CONTRACT_DIALECT*`
- `INDEXER_*`
- `NEOFS_*`
- `GHOSTMARKET_*`

### Variables That Should Not Be Exposed To The Client

- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_SECRET_KEY`
- `SUPABASE_KEY`
- `POSTGRES_URL`
- `POSTGRES_URL_NON_POOLING`
- `POSTGRES_PASSWORD`
- `SUPABASE_JWT_SECRET`

### Current State

The API now resolves Supabase config from server-side variables only. It no longer uses `NEXT_PUBLIC_SUPABASE_*` fallbacks inside the server runtime.

### Recommendation

Use only:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

for production API configuration on Vercel.

Do not rely on `NEXT_PUBLIC_SUPABASE_*` inside the serverless runtime.

## 3. Frontend Wallet Debug Audit

### Current State

Wallet diagnostics in [apps/web/src/lib/neoline.ts](/Users/jinghuiliao/git/NFT/apps/web/src/lib/neoline.ts) are now gated behind:

- `import.meta.env.DEV`
- or `VITE_WALLET_DEBUG === "true"`

### Recommendation

- Keep `VITE_WALLET_DEBUG` unset in production by default.
- Only enable it temporarily when debugging wallet/provider issues.
- If you enable it in production for incident response, remove it immediately after the investigation.
- Transaction debug logs used by local E2E are gated to `DEV` and should not appear in production bundles.

## 4. API CORS Audit

### Current State

- `API_CORS_ORIGIN` no longer defaults to `*`
- the API now allows:
  - no-origin requests
  - explicitly configured browser origins
  - loopback origins such as `http://localhost:*` and `http://127.0.0.1:*`

### Recommendation

- In production, set `API_CORS_ORIGIN` to a comma-separated allowlist of your real frontend origins.
- Do not use `*` unless you explicitly want a fully public browser API surface.

## 5. Recommended Vercel Environment Split

### Server / API Runtime

Set these in Vercel project env:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEO_DEFAULT_NETWORK`
- `NEO_RPC_URL`
- `NEO_RPC_URL_MAINNET`
- `NEO_RPC_URL_TESTNET`
- `NEO_RPC_URL_PRIVATE`
- `NEO_CONTRACT_HASH`
- `NEO_CONTRACT_HASH_MAINNET`
- `NEO_CONTRACT_HASH_TESTNET`
- `NEO_CONTRACT_HASH_PRIVATE`
- `NEO_CONTRACT_DIALECT`
- `NEO_CONTRACT_DIALECT_MAINNET`
- `NEO_CONTRACT_DIALECT_TESTNET`
- `NEO_CONTRACT_DIALECT_PRIVATE`
- `INDEXER_ENABLE_EVENTS`
- `INDEXER_POLL_MS`
- `INDEXER_BATCH_SIZE`
- `INDEXER_BOOTSTRAP_BLOCK_WINDOW`
- `INDEXER_START_BLOCK`
- `NEOFS_*`
- `GHOSTMARKET_*`

### Frontend Build-Time Variables

Set only the client-safe variables:

- `VITE_API_BASE_URL`
- `VITE_API_BASE_URL_MAINNET`
- `VITE_API_BASE_URL_TESTNET`
- `VITE_API_BASE_URL_PRIVATE`
- `VITE_NEO_RPC_URL`
- `VITE_NEO_RPC_URL_MAINNET`
- `VITE_NEO_RPC_URL_TESTNET`
- `VITE_NEO_RPC_URL_PRIVATE`
- `VITE_NEO_CONTRACT_HASH`
- `VITE_NEO_CONTRACT_HASH_MAINNET`
- `VITE_NEO_CONTRACT_HASH_TESTNET`
- `VITE_NEO_CONTRACT_HASH_PRIVATE`
- `VITE_CONTRACT_DIALECT`
- `VITE_WALLET_DEBUG` only when intentionally debugging

### Do Not Put Into Frontend Env

- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_SECRET_KEY`
- `POSTGRES_*`
- `SUPABASE_JWT_SECRET`

## 6. Operational Recommendations

Before shipping production config changes:

1. Run the static audit script:

```bash
node scripts/audit-production-config.mjs
```

2. Run project validation:

```bash
npm run check
npm run build
npm run smoke:e2e
npm run smoke:trade
```

3. If wallet behavior is part of the release, also run:

```bash
NEO_TEST_WIF=... npm run test:wif-ui
```

4. Confirm Vercel is building the intended commit, not an older one.
5. Confirm `VITE_WALLET_DEBUG` is blank in production unless actively debugging.
6. Confirm only server-side Vercel env holds Supabase service credentials.

## 7. GitHub Actions Recommendation

Use the manual workflow in `.github/workflows/production-audit.yml` to run:

- `npm run audit:production-config`
- `npm run check`
- `npm run build`
- `npm run smoke:trade`
- optionally `npm run test:wif-ui` when `NEO_TEST_WIF` is configured as a repository secret
