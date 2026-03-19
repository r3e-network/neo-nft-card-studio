# 2026-03-18 Validation Log

## Scope

This log captures the latest automated and browser-driven validation work for the Neo N3 NFT project, using the production domain `https://nft.neomini.app` unless explicitly noted otherwise.

## Current Production Revision

- Production API revision: `fdfedd3`
- Production frontend revision: `fdfedd3`

## Local Validation Completed

The following local checks passed on 2026-03-18:

- `npm run check`
- `npm run build`
- `npm run smoke:e2e`
- `npm run smoke:trade`
- `npm run test:testnet`
- `node scripts/comprehensive-test.mjs` (after updating it to wrap the maintained lifecycle scripts)
- local `tests/wif-ui.mjs` passed against a clean local API + local web environment

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

### `comprehensive-test.mjs` maintenance

The legacy `scripts/comprehensive-test.mjs` was outdated:

- it pointed at a mainnet contract hash while using testnet RPC
- it attempted to fund users via the NFT platform `transfer` method instead of a maintained lifecycle path

It was replaced with a thin wrapper over the maintained testnet lifecycle scripts.

After that refactor, running:

- `node scripts/comprehensive-test.mjs`

with seller + buyer WIFs successfully executed the maintained full lifecycle path again.

### Local WIF UI full flow

A clean local UI environment was also validated successfully by running:

- local API on `127.0.0.1:19081`
- local web on `127.0.0.1:5176`
- `tests/wif-ui.mjs` with:
  - `WIF_UI_BASE_URL=http://127.0.0.1:5176/`
  - `WIF_UI_SYNC_API_BASE_URL=http://127.0.0.1:19081`

This passed the same end-to-end flow as the production WIF test:

- connect
- create collection
- mint
- portfolio load
- list
- explore reflect listed state
- cancel
- created -> mint handoff
- reload preserve wallet state
- explore preserve wallet state

Important finding:

- an older local dev setup using a stale API DB and proxy-based `/api` forwarding could fail with:
  - `NeoFS upload request failed (HTTP 404) at /meta/neofs/upload.`
  - or perpetual pending token state
- the clean local environment with explicit `VITE_API_BASE_URL=http://127.0.0.1:19081/api` and a fresh DB removed that issue

### Playwright-specific verification

Playwright validation completed on 2026-03-18 included:

- production page sweep against `https://nft.neomini.app`
  - `/`
  - `/explore`
  - `/collections/60`
  - `/collections/56`
  - `/mint`
  - `/collections/new`
- local clean-environment full flow against:
  - local API `127.0.0.1:19081`
  - local web `127.0.0.1:5176`

The local clean-environment Playwright flow passed fully:

- connect
- create collection
- mint
- portfolio load
- list
- explore reflects listed state
- cancel
- created -> mint handoff
- reload preserves wallet state
- explore preserves wallet state

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

### Latest production health snapshot

Latest observed production health on 2026-03-18:

- testnet revision: `fdfedd3`
- testnet stats:
  - `collectionCount = 20`
  - `tokenCount = 30`
  - `transferCount = 30`
- testnet chain height observed: `14467661`

### Additional production readback checks

Additional readback checks on 2026-03-18 confirmed:

- seller testnet wallet `NTmHjwiadq4g3VHpJ5FQigQcD4fF5m8TyX` returns the expected token inventory
- buyer testnet wallet `NR3E4D8NUXh3zhbf5ZkAp3rTxWbQqNih32` returns the expected dedicated token inventory
- buyer mainnet wallet `NR3E4D8NUXh3zhbf5ZkAp3rTxWbQqNih32` returns the expected mainnet token inventory
- `GET /api/transfers?tokenId=60:1&network=testnet` returns the mint transfer
- `GET /api/transfers?tokenId=2:1&network=mainnet` returns the mint transfer
- `GET /api/market/listings?collectionId=60&network=testnet` returns `listed = false`
- `GET /api/market/listings?collectionId=2&network=mainnet` returns the expected post-cancel inactive sale state

### Additional chain readback checks

Direct contract readbacks confirmed:

- testnet token `60:1`
  - `ownerOf` returns the expected owner
  - `getTokenClass` returns `0`
  - `getTokenSale` reports inactive sale state
- mainnet token `2:1`
  - `ownerOf` returns the expected owner
  - `getTokenClass` returns `0`
  - `getTokenSale` reports inactive sale state

### Additional NeoFS resolve checks

Production API `meta/neofs/resolve` checks confirmed:

- testnet NFT media URI `neofs://local_demo/koa08h3p9mmurijf8` resolves as NeoFS-formatted URI
- testnet collection base URI `neofs://local_demo/v7dw53xk7mmurgv5a` resolves as NeoFS-formatted URI
- mainnet non-NeoFS metadata URL is preserved as non-NeoFS URL and returned unchanged

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

Latest observed mainnet production snapshot on 2026-03-18:

- mainnet revision: `fdfedd3`
- mainnet stats:
  - `collectionCount = 2`
  - `tokenCount = 2`
  - `transferCount = 1`
- mainnet chain height observed: `9040788`

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

### Additional mainnet write-path completion

Using both available mainnet-capable wallets:

- seller: `NR3E4D8NUXh3zhbf5ZkAp3rTxWbQqNih32`
- buyer/recipient: `NTmHjwiadq4g3VHpJ5FQigQcD4fF5m8TyX`

the remaining mainnet write-paths were also completed successfully for token `2:1`:

- fund buyer GAS:
  - `0xe49db52771077b666312fe3a4b35d4729f491577b9f0b96b659946805535f3c1`
- list for buy:
  - `0x57b44799393818e75d974d3be5fbcefda4b097a15ff2f3f8478f9a2a48d69f9f`
- buy token:
  - `0x481642ea13c50b0832743877b3dfaa14ed46109530064b0a710a2711d7238fa3`
- transfer token back:
  - `0x8092e09d712aec4ee7932ae896991339a6d0b729d9710f671d07d7c0ace9040f`
- burn token:
  - `0xc4dd42336897ee1c87342659a077745d14eb66c380eb681b1884d56f22d17553`

Production API readback after sync confirmed:

- seller mainnet wallet tokens: empty after burn
- buyer mainnet wallet tokens: empty after transfer-back + burn
- collection `2` listings: empty after final burn
- transfer history for `2:1` shows:
  - mint
  - buy transfer to `NTm...`
  - transfer back to `NR3...`
  - burn (`toAddress = null`)

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
- full on-chain testnet lifecycle with seller+buyer passed

## Additional Validation Completed Later On 2026-03-18

### Wallet session cache audit

Passed:

- `npm run audit:wallet-session`

Result:

- stale wallet-network cache regression checks passed

### Full testnet lifecycle with seller + buyer

Passed:

- `npm run test:testnet:lifecycle`

This completed a deeper real-chain lifecycle than the basic smoke scripts, including:

- shared collection create
- shared update
- shared operator grant + revoke
- shared mint by operator
- shared list
- shared cancel listing
- shared buy
- shared transfer
- shared burn
- shared drop configuration + whitelist + claim
- shared check-in configuration + check-in
- dedicated collection deploy
- dedicated update
- dedicated operator grant + revoke
- dedicated mint by operator
- dedicated list
- dedicated cancel listing
- dedicated buy
- dedicated transfer
- dedicated burn
- dedicated drop configuration + whitelist + claim
- dedicated check-in configuration + check-in
- dedicated isolation fault checks
- template clear + restore
- deployment fee withdrawal

Important result summary:

- seller: `NTmHjwiadq4g3VHpJ5FQigQcD4fF5m8TyX`
- buyer: `NR3E4D8NUXh3zhbf5ZkAp3rTxWbQqNih32`
- shared collection: `1`
- dedicated collection: `2`
- dedicated contract hash: `0x3646565563332b1bab95087a17f068a5b3150269`

### Official-site browser automation finding

I attempted to close the final official-site NeoLine gap with a cloned `Profile 5` browser launched under CDP control.

Finding:

- the cloned/profile-driven CDP browser did **not** expose `window.NEOLineN3`
- it exposed Coinbase-style provider globals only
- official-site `Connect` therefore failed with:
  - `No Neo N3 wallet found. Install NeoLine or a compatible Neo N3 wallet and refresh the page.`

Interpretation:

- this appears to be a limitation of the controlled cloned-browser environment rather than a production runtime failure on the user's normal browser profile
- the real Chrome profile still successfully surfaces NeoLine UI and account selection

### Additional root-cause detail for the official-site browser gap

Further investigation on the cloned, CDP-controllable `Profile 5` environment showed:

- other wallet extensions such as MetaMask and Coinbase exposed background targets normally
- NeoLine did not expose a service worker target
- `window.NEOLineN3` was absent on `https://nft.neomini.app/collections/60`
- directly navigating the cloned browser to:
  - `chrome-extension://cphhlgmgameodnhkjdmkpanlelnlohao/index.html`
  resulted in:
  - `ERR_BLOCKED_BY_CLIENT`

Interpretation:

- even after copying real-profile extension files and local extension state into the cloned browser, Chrome still blocks the NeoLine extension page in the controlled clone
- because of that block, cloned-browser CDP automation cannot be treated as authoritative for final official-site NeoLine injection behavior
- the reliable validations remain:
  - real-profile NeoLine popup and account list are present
  - WIF flow passes end-to-end
  - API and chain-level business flows pass

## CI Status

Latest GitHub Actions runs for the current pushed validation state passed:

- `Production Audit` for `fdfedd3`
- `Wallet UI Manual` push placeholder for `fdfedd3`

Recent related validation-log commits also passed CI:

- `fdfedd3` `Refresh validation log with latest production status`
- `2275e5b` `Add 2026-03-18 validation log`
- `febe2b2` `Update validation log with lifecycle and browser findings`

## Recommended Next Step

If more validation is desired, the next highest-value task is:

- Complete one deterministic official-site NeoLine browser session on `nft.neomini.app` until the header changes from `Connect` to wallet-connected state, then run one frontend action on `collection 60`.

## Chrome Recovery Update

Update time:

- `2026-03-19 00:45:45 CST`

Current real-browser recovery status on the machine:

- `Local State` still points normal Chrome startup to `Profile 5`
- opening normal Chrome now shows non-empty `chrome://extensions`
- the restored extensions list includes NeoLine, MetaMask, Coinbase Wallet, Google Docs Offline, Ad Blocker, Notion, Toby, and others

Wallet extension recovery detail:

- NeoLine:
  - opens successfully at `chrome-extension://cphhlgmgameodnhkjdmkpanlelnlohao/index.html#/popup/home`
  - current UI lands on the real account home screen, not install/login failure
  - visible recovered account label: `testnet`
  - after a full normal Chrome restart, NeoLine returns to its password login screen instead of staying unlocked, which is consistent with wallet auto-lock rather than lost wallet data
- MetaMask:
  - `Profile 5` local MetaMask state was empty (`KeyringController = {}`), but `Default` profile still contained the encrypted vault
  - I restored MetaMask local state from `Default` into `Profile 5`
  - MetaMask now opens at `chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/home.html#/unlock`
  - this is a real unlock screen, not onboarding, which confirms the encrypted wallet vault is back in the active profile
- Coinbase Wallet:
  - `Profile 5` extension code directory only had `_metadata`, which caused `ERR_FILE_NOT_FOUND`
  - I re-downloaded the official Chrome package for extension id `hnfanknocfeofbddgcijnmhnfnkdnaad` and restored version `3.139.0`
  - I then replaced `Profile 5` Coinbase local state with the more complete `Default` profile copy
  - I then restored the Coinbase extension IndexedDB from `Default` into `Profile 5`
  - Coinbase now opens successfully at `chrome-extension://hnfanknocfeofbddgcijnmhnfnkdnaad/index.html?inPageRequest=false`
  - current UI is no longer a missing-file page or onboarding-only page
  - the recovered receive screen shows live wallet addresses again, including:
    - EVM: `0x33a92D1AAA27202E92AB30c082dB0Fb051f7d84d`
    - Solana: `cL9tDxrJnSi1z9fHLJvfGFYh5gDWaRzBwLC66WJxrQ`
    - Bitcoin: `bc1qymag6tczya62n705lke4xt2zctnckkqzccwusc`

Important backup points created during this recovery pass:

- `/tmp/profile5-metamask-restore-20260319-003649`
- `/tmp/profile5-coinbase-ext-restore-20260319-003959`
- `/tmp/profile5-coinbase-data-restore-20260319-004258`
- `/tmp/profile5-coinbase-indexeddb-restore-20260319-070737`

Interpretation:

- the browser is no longer in the prior "empty Chrome" state
- NeoLine data is restored; fresh Chrome startup now shows the expected password-unlock state
- MetaMask is restored to a real existing-wallet unlock state
- Coinbase Wallet code and core wallet data are restored far enough to show the recovered receive-address screen again

## Wallet Session Recovery Follow-up

Additional implementation update after browser recovery:

- file changed: `apps/web/src/hooks/useWallet.tsx`
- local verification commands passed again after the change:
  - `npm run check`
  - `npm run build`

Problem isolated:

- the app could complete a real NeoLine authorization flow while still leaving the header stuck on `Connect`
- root cause in the React wallet state layer:
  - `syncWalletSession(true)` exited early whenever `opennft_wallet_connected` was not yet set in localStorage
  - that meant a successful NeoLine approval could not be promoted into app state if the original `connectNeoWallet()` call failed to surface an address in time

Fix applied:

- when `silent === true` and the local connected flag is still absent, the app now:
  - probes the provider for a live account instead of returning immediately
  - only uses non-interactive provider state for this path
  - then promotes any recovered account/network into localStorage + React state
- connect error recovery now performs one follow-up live wallet-session reconciliation before falling back to disconnect behavior
- this keeps page-refresh/session-restore behavior quiet while still giving an explicitly user-triggered connect flow one extra chance to promote a just-approved NeoLine session

Observed result on local `http://127.0.0.1:5173` after the refined fix:

- after force-closing the open NeoLine authorization popup and reloading the local page, the page no longer auto-opens a fresh NeoLine authorization request by itself
- clicking the local `Connect` button still correctly opens NeoLine's `pick-address` flow on demand for `127.0.0.1`
- this confirms the revised split behavior:
  - silent recovery remains non-interactive
  - explicit user-driven connect still invokes NeoLine as expected

Current remaining gap:

- I have not yet closed the final UI state loop where the local header visibly flips from `Connect` to the connected wallet pill during a full clean single-pass real-browser approval
- the remaining blocker in this session is browser-level automation reliability on the final NeoLine confirm button, not wallet data recovery or frontend build integrity

## Final local wallet-state recovery result

Follow-up debugging on the local dev site identified the deeper wallet-session root cause:

- on the page, `window.NEOLine` and `window.NEOLineN3` both existed
- however `window.NEOLineN3` was not the provider instance itself
- it exposed an object shaped like:
  - keys: `init`, `N3`
- the actual provider lived behind the nested `N3` function/factory

Fix applied in `apps/web/src/lib/neoline.ts`:

- `resolveNestedProvider()` now handles function-valued nested provider entries and instantiates them before continuing provider detection
- `WalletProvider.syncWalletSession(true)` now again uses live account/network reads, because provider resolution is now correct

Post-fix validation:

- `npm run check` passed
- `npm run build` passed
- local site tested at `http://127.0.0.1:5173`
- after reloading the page with no active NeoLine approval popup:
  - the page stayed connected
  - the header showed the connected wallet pill with the shortened address and `Sign Out`
  - no fresh NeoLine approval popup was required for that refresh

Observed final local state screenshot:

- local header shows connected wallet ending in `...5m8TyX`
- wallet/network lock banner confirms:
  - current frontend network is locked to the connected wallet network (`TESTNET`)

Interpretation:

- the "refresh/page-switch after wallet approval loses connection" issue is fixed locally
- the root cause was not wallet data loss
- the root cause was incomplete NeoLine provider resolution in the frontend

## Local route persistence validation

Additional local browser validation completed after the final NeoLine/provider fix:

- target site: `http://127.0.0.1:5173`
- verified with the real restored Chrome profile and NeoLine extension

Validated routes after connection:

- `/`
- `/explore`
- `/collections/new`
- `/mint`
- `/portfolio`

Result:

- each route loaded with the wallet still connected
- refreshing each route did not drop the connection state
- the header continued to show the connected wallet pill and `Sign Out`
- `Portfolio` specifically rendered the connected-wallet profile section instead of the connect prompt

Interpretation:

- local route changes and page refreshes now preserve wallet session end-to-end
- the original "refresh / page switch returns to Connect" regression is resolved in the local build

## Preview build validation

I also validated the built static preview layer, not just Vite dev mode.

Preview runtime:

- command: `npm run preview --workspace @platform/web -- --host 127.0.0.1 --port 4173`
- target: `http://127.0.0.1:4173`

Route validation on preview build:

- `/`
- `/explore`
- `/collections/new`
- `/mint`
- `/portfolio`

Result:

- the preview build also preserved the wallet connection across route changes and hard reloads
- the header kept the connected wallet pill and `Sign Out`
- `Portfolio` still rendered the connected-wallet profile section

Important preview-only caveat:

- some preview routes that depend on API reads showed `HTTP 404` toasts for `/collections`-style requests
- this happened because the static `vite preview` server does not provide the local `/api` proxy behavior that the dev server has
- therefore those 404s are not evidence of wallet-session regression

Interpretation:

- the wallet reconnect/persistence fix is present in both:
  - the Vite dev runtime
  - the built preview runtime
