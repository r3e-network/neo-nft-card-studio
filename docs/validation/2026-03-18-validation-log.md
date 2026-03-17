# 2026-03-18 Validation Log

## Scope

This log captures the latest automated and browser-driven validation work for the Neo N3 NFT project, using the production domain `https://nft.neomini.app` unless explicitly noted otherwise.

## Current Production Revision

- Production API revision: `3a1feca`
- Production frontend revision: `3a1feca`

## Local Validation Completed

The following local checks passed on 2026-03-18:

- `npm run check`
- `npm run build`
- `npm run smoke:e2e`
- `npm run smoke:trade`
- `npm run test:testnet`

### `test:testnet` chain results

The on-chain lifecycle script succeeded with:

- Platform deploy
- Template install
- Template name segment config
- `createCollectionAndDeployFromTemplate`
- `mint`
- `configureCheckInProgram`
- `checkIn`
- `transfer`
- `burn`
- Dedicated contract isolation checks

Important outputs:

- Seller/deployer: `NTmHjwiadq4g3VHpJ5FQigQcD4fF5m8TyX`
- Collection ID: `1`
- Token ID: `1:1`
- Check-in proof token ID: `1:2`
- Dedicated collection contract hash: `0x84bf271cea5ec11a6e750d9687cda4dfcfc48b2d`

## Production Testnet Validation Completed

### Browser-driven WIF flow

The production testnet WIF flow passed end-to-end against `https://nft.neomini.app`:

- Connect
- Create Collection
- Mint
- Portfolio load after route change
- List for sale
- Explore reflects listed state
- Cancel listing
- Created -> Mint handoff
- Reload preserves wallet state
- Explore reload preserves wallet state

### Testnet collection and token checks

Confirmed via production API:

- `collection 60` exists
- Name: `Playwright E2E Collection 1773760937683`
- Symbol: `E683`
- Owner: `NTmHjwiadq4g3VHpJ5FQigQcD4fF5m8TyX`
- Minted: `1`
- Token: `60:1`
- Listing state: `listed = false`

### Testnet max supply check

`collection 56` was validated as a max-supply case:

- `maxSupply = 2`
- API shows `minted = 2`
- Tokens indexed: `56:1`, `56:2`
- Additional mint attempt faults on-chain with `Collection sold out`

## Production Mainnet Validation Completed

### Read-path validation

Production mainnet health is healthy:

- Contract hash: `0xc1868eba3ce06ad93962378537f8a59f3cae1548`
- RPC: `https://mainnet1.neo.coz.io:443`

Mainnet currently indexes at least:

- `collectionCount = 1`
- `tokenCount = 1`

### Real write-path validation

Using mainnet WIF for address `NR3E4D8NUXh3zhbf5ZkAp3rTxWbQqNih32`, the following transactions succeeded on mainnet:

- `createCollection`: `0xdef5f2a63bc95a4dbb48dfadb9972cc1afa7d20e8ce75a1f5560020f3544d73a`
- `mintStandard`: `0x87f28960ce70ac41b4ea7388d5ed7d0f270df278c3dd7d403f217bc2809faeda`
- `listTokenForSale`: `0x99cc9d90480bfb9fd4c5809381e58f5257b62af7ed6c47f3cf9d3c45724076fc`
- `cancelTokenSale`: `0x7d149d173d174eebd23bea1e4c25d2224c54f341a4364a39de57a42b1519176e`

Created mainnet assets:

- Collection ID: `2`
- Collection name: `Mainnet Verify 1773762256989`
- Symbol: `MV6989`
- Token ID: `2:1`

Production API readback after sync confirmed:

- `collection 2` exists
- `minted = 1`
- token `2:1` exists and belongs to `NR3E4D8NUXh3zhbf5ZkAp3rTxWbQqNih32`
- listing state is `listed = false` after cancel
- route `/collections/2` resolves to SPA page successfully

## Route and SPA Validation

Production routes confirmed to resolve correctly:

- `/`
- `/explore`
- `/portfolio`
- `/collections/56`
- `/collections/60`
- `/collections/2`
- `/mint`
- `/collections/new`

The Vercel rewrite fix for dynamic collection routes was deployed earlier and validated in production.

## `collection 61` Investigation

`collection 61` does **not** exist in the current production testnet API.

Validated facts:

- `GET /api/collections/61?network=testnet` returns `404`
- Latest real collections for the seller are `60`, `59`, `58`, `57`, `56`
- `60` is the latest confirmed successful collection

### Root cause of repeated refresh

The repeated refresh behavior was caused by a stale browser `localStorage` record for:

- `opennft_pending_collections`

on the old preview host:

- `neo-nft-card-studio-api-git-main-jimmys-projects-f05d0acf.vercel.app`

That stale entry referenced:

- `collectionId = 61`
- `name = test4`

while the real API returned `404`.

This produced a false "still indexing" fallback loop in `CollectionDetailPage`.

### Fix

Implemented and deployed in commit:

- `3a1feca` `Expire stale pending collection fallbacks`

Fix details:

- Added TTL-based pruning for pending collections
- Added explicit cleanup when a real collection is fetched

## Browser / Chrome Recovery

Chrome recovery work completed for the user's normal browser state:

- Restored NeoLine sync settings from backup
- Removed automation temp profile
- Reinstalled NeoLine in the real profile when Chrome stopped surfacing it
- Restored working extension state under the actual default profile

Important finding:

- System Chrome opens by default into `Profile 5`
- Earlier recovery work was initially performed on `Profile 4`
- Browser state was then aligned back to `Profile 5`

Confirmed after recovery:

- `Profile 5` is the default profile again
- Extension list is restored
- NeoLine is present in extension management
- NeoLine local wallet DB contains the previously used wallet records

## Remaining Gaps

The following are still not fully closed by real browser automation on `nft.neomini.app`:

- Official-site NeoLine connection finalization was driven up to:
  - popup open
  - password entry
  - account list display
  - testnet account selection
- However, the final production page state was not deterministically observed as switched from `Connect` to connected wallet state via browser automation alone

This gap does **not** invalidate the functional validation already completed, because:

- production WIF UI flow passed end-to-end
- production API read/write paths were verified
- chain-level lifecycle scripts passed
- mainnet write-path transactions succeeded directly

## Recommended Next Step

If more validation is desired, the next highest-value task is:

- Complete one deterministic official-site NeoLine browser session on `nft.neomini.app` until the header changes from `Connect` to wallet-connected state, then run one frontend action on `collection 60`.
