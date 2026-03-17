# Production Wallet / Marketplace Recovery Runbook

This document records the production recovery work completed on 2026-03-17 for NeoLine wallet integration, dedicated collection deployment, and dedicated marketplace flows on testnet.

Use it when:

- a release regresses wallet connection
- dedicated contract creation stops working
- listed state differs between API and frontend
- NeoLine popups appear but actions do not complete

Relevant files:

- [apps/web/src/lib/neoline.ts](/Users/jinghuiliao/git/NFT/apps/web/src/lib/neoline.ts)
- [apps/web/src/hooks/useWallet.tsx](/Users/jinghuiliao/git/NFT/apps/web/src/hooks/useWallet.tsx)
- [apps/web/src/pages/CreateCollectionPage.tsx](/Users/jinghuiliao/git/NFT/apps/web/src/pages/CreateCollectionPage.tsx)
- [apps/web/src/pages/CollectionDetailPage.tsx](/Users/jinghuiliao/git/NFT/apps/web/src/pages/CollectionDetailPage.tsx)
- [apps/web/src/pages/ExplorePage.tsx](/Users/jinghuiliao/git/NFT/apps/web/src/pages/ExplorePage.tsx)
- [packages/neo-sdk/src/contract-client.ts](/Users/jinghuiliao/git/NFT/packages/neo-sdk/src/contract-client.ts)

## 1. Production State After Recovery

Validated production revision chain:

- `6a0165f` wallet connect + session restore
- `7dd387b` disable dedicated create when template missing
- `3aaa078` fix dedicated create wallet invocation
- `faff609` fix collection detail listing refresh limit
- `0665a16` fix marketplace buy wallet signer scopes

Production health after recovery:

- revision: `0665a16`
- network: `testnet`
- contract hash: `0xbf7607d16a9ed9e7e9a8ebda24acbedcd6208b22`

## 2. Root Causes Fixed

### 2.1 NeoLine connect failed after approval

Symptoms:

- wallet popup opened
- approval succeeded
- frontend still showed `Connect`
- some cases entered repeated `connect -> switch account -> failed`

Root cause:

- connection logic triggered too many interactive account methods too quickly
- `switchWalletAccount()` was being attempted during connect
- session restore did not reliably reuse persisted address/network after reload

Fixes:

- increase interactive wait window in [apps/web/src/lib/neoline.ts](/Users/jinghuiliao/git/NFT/apps/web/src/lib/neoline.ts)
- remove automatic `switchWalletAccount()` from connect flow
- initialize wallet state from persisted local storage in [apps/web/src/hooks/useWallet.tsx](/Users/jinghuiliao/git/NFT/apps/web/src/hooks/useWallet.tsx)

### 2.2 Dedicated create unavailable on testnet

Symptoms:

- dedicated option existed in UI
- submit failed with `Dedicated contract template is not configured on this network.`

Root cause:

- factory contract on testnet did not have template NEF / manifest / manifest-name segments configured

Fixes:

- temporarily gate dedicated mode in UI using live on-chain checks
- restore factory template on-chain

On-chain recovery txids:

- `setCollectionContractTemplate`:
  - `0x8ea4615e464ecb0ae0d87d2ae6f6c4c51babc9c517f03f35c02cd9c8d46e195b`
- `setCollectionContractTemplateNameSegments`:
  - `0x1e0dfa2071f837d1bb936d4eb7e6ba119e52323f4a9458904b68135d594500ee`

### 2.3 Dedicated create popup showed `0 GAS` and could not confirm

Symptoms:

- NeoLine popup opened for `createCollectionAndDeployFromTemplate`
- total showed `0 GAS`
- confirm button was effectively unusable

Root cause:

- dedicated create transfers 10 GAS from the caller through contract logic
- default frontend signer scope was `CalledByEntry`
- test invoke showed:
  - `CalledByEntry` => `FAULT`
  - `Global` => `HALT`

Fix:

- dedicated create now sets explicit `Global` signer in [apps/web/src/pages/CreateCollectionPage.tsx](/Users/jinghuiliao/git/NFT/apps/web/src/pages/CreateCollectionPage.tsx)

### 2.4 Dedicated extraData encoding was brittle for NeoLine

Symptoms:

- NeoLine popup sometimes showed generic input validation failure on dedicated create

Root cause:

- dedicated extraData was encoded as `Any(JSON stringified object)` which NeoLine handled inconsistently

Fix:

- [packages/neo-sdk/src/contract-client.ts](/Users/jinghuiliao/git/NFT/packages/neo-sdk/src/contract-client.ts) now emits explicit `String` / `Integer` / `Boolean` / `Any(null)` argument types for extraData

### 2.5 Collection detail page showed `Not listed` while API said `listed: true`

Symptoms:

- `/api/market/listings?collectionId=48` returned listed token
- collection detail page still rendered `Not listed`

Root cause:

- frontend requested `fetchMarketListings({ limit: 5000 })`
- API validates `limit <= 500`
- browser request returned `400 Invalid query`
- page swallowed the failure and fell back to empty sales state

Fix:

- collection detail listing refresh now uses `limit: 500` in [apps/web/src/pages/CollectionDetailPage.tsx](/Users/jinghuiliao/git/NFT/apps/web/src/pages/CollectionDetailPage.tsx)

### 2.6 Marketplace buy popup showed `0 GAS` and did not complete

Symptoms:

- dedicated `buyToken` popup opened
- total showed `0 GAS`
- NeoLine confirm state was broken

Root cause:

- buy path also needed wider signer scope for contract-mediated payment flow

Fixes:

- collection detail buy now sets explicit `Global` signer in [apps/web/src/pages/CollectionDetailPage.tsx](/Users/jinghuiliao/git/NFT/apps/web/src/pages/CollectionDetailPage.tsx)
- explore buy also sets explicit `Global` signer in [apps/web/src/pages/ExplorePage.tsx](/Users/jinghuiliao/git/NFT/apps/web/src/pages/ExplorePage.tsx)

## 3. End-to-End Transactions Verified

### Shared mode

- create collection:
  - `0x9731a4afbbe56e8c4772bf9000d86b95d10f384e26a596d21c29ae475784c311`
- mint:
  - `0xbee6ea5853d6a80732c133f4d21f0ab411e5521fcb2f1d96b69d5d3ca1fb749a`

### Dedicated mode

- create dedicated collection:
  - `0x694756e1fc886e6495b9a8f90389cd718c2a768986879faccef2eb017345374c`
- mint into dedicated contract:
  - `0x15221fa8a804206c5c61e3e51518e137b9cd0c0c3ea22ea8e8b720bfba57fc67`

### Dedicated market validation

- list:
  - API confirmed `48:1` with `listed: true` and price `123000000`
- cancel:
  - API confirmed `48:1` with `listed: false`
- buy:
  - API confirmed owner moved from `NTmHjwiadq4g3VHpJ5FQigQcD4fF5m8TyX` to `NR3E4D8NUXh3zhbf5ZkAp3rTxWbQqNih32`
  - API confirmed `sale.listed: false`

## 4. Dedicated Collection Verified

Created dedicated collection:

- collection id: `48`
- name: `Dedicated Local 1773718566775`
- symbol: `DY775`
- contract hash: `0x2b8148209a1215cd660f815dbfcde6c1577138fe`

Verified token:

- token id: `48:1`
- name: `Dedicated Prod NFT 1773718977844`

Final verified owner:

- `NR3E4D8NUXh3zhbf5ZkAp3rTxWbQqNih32`

## 5. Required Operational Checks Before Release

1. Confirm production health:

```bash
curl -fsS 'https://nft.neomini.app/api/health?network=testnet'
```

2. Confirm factory template availability:

```bash
node - <<'NODE'
const { NeoNftPlatformClient } = require('./packages/neo-sdk/dist/index.js');
(async () => {
  const client = new NeoNftPlatformClient({
    rpcUrl: 'http://seed2t5.neo.org:20332',
    contractHash: '0xbf7607d16a9ed9e7e9a8ebda24acbedcd6208b22',
    dialect: 'csharp',
  });
  console.log(await client.hasCollectionContractTemplate());
  console.log(await client.hasCollectionContractTemplateNameSegments());
})();
NODE
```

3. Confirm collection detail listing fetch is not returning `400`:

```bash
curl -fsS 'https://nft.neomini.app/api/market/listings?collectionId=48&limit=500&network=testnet'
```

4. Re-run manual wallet regression on production:

- connect seller wallet
- create shared collection
- mint shared token
- list/cancel shared token
- create dedicated collection
- mint dedicated token
- list/cancel dedicated token
- switch NeoLine account
- buy dedicated token as second wallet

## 6. Important Lessons

1. For NeoLine, a popup showing is not enough. Always verify the frontend state actually updates after approval.
2. Contract-mediated GAS payment flows may require `Global` signer scope even when simpler invokes work with `CalledByEntry`.
3. If API query validation rejects a request, collection pages can silently drift out of sync unless the error is surfaced.
4. Dedicated mode must be gated by live template availability, not by product intent.
5. When validating production, always confirm both:
   - frontend state
   - API/indexed state

