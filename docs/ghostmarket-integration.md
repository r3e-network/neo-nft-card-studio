# GhostMarket Integration Guide

## 1. Target

This project exposes GhostMarket-ready hooks for Neo N3 NFTs in both modes:

- Primary production mode: C# factory deploys per-creator dedicated NFT contracts.
- Compatibility mode: shared multi-tenant NFT contract (Solidity / Rust).

Implemented across contracts:

- `getRoyalties(tokenId)`
- `royaltyInfo(tokenId, royaltyToken, salePrice)`
- `tokenURI(tokenId)`
- `properties(tokenId)`

## 2. Contract Requirements

GhostMarket-oriented compatibility checks in API (`GET /api/meta/ghostmarket`) verify:

- `NEP-11` support in manifest
- Core NFT methods (`ownerOf`, `transfer`, `tokenURI`, `properties`)
- Royalties extension method (`getRoyalties`)
- `onNEP11Payment` handler presence (warning-level check for inbound NFT transfer compatibility)
- Reasonable return/parameter type shapes from on-chain manifest

`getRoyalties` behavior in this repo:

- C# / Solidity: returns serialized JSON royalties payload (address + bps)
- Rust: returns serialized JSON royalties payload (address + bps), while still supporting legacy integer-ref bridge mode for non-address fields.

## 3. Environment Configuration

Set in `.env`:

```bash
GHOSTMARKET_ENABLED=true
GHOSTMARKET_BASE_URL=https://ghostmarket.io
GHOSTMARKET_COLLECTION_URL_TEMPLATE=https://ghostmarket.io/asset/neo/{contractHash}/{collectionId}
GHOSTMARKET_TOKEN_URL_TEMPLATE=https://ghostmarket.io/asset/neo/{contractHash}/{tokenId}
```

If GhostMarket route format changes, only update URL templates (no code changes required).

## 4. Backend Endpoints

- `GET /api/meta/ghostmarket`
  - Compatibility report
  - Manifest snapshot (from RPC `getContractState`)
  - Generated URL templates
- `GET /api/meta/ghostmarket/collection/:collectionId`
  - Filled collection URL
- `GET /api/meta/ghostmarket/token/:tokenId`
  - Filled token URL

## 5. Frontend Integration

- Home page:
  - Shows GhostMarket compatibility status and actionable reasons/warnings.
- Collection detail page:
  - "Open Collection on GhostMarket"
  - Per-token "Open on GhostMarket"

## 6. Deployment and Listing Flow

1. Build and deploy your selected contract dialect (`csharp` recommended for production).
2. Set `NEO_CONTRACT_HASH` and `NEO_CONTRACT_DIALECT`.
3. For C# factory mode, run compatibility check against the dedicated NFT contract hash (not factory hash).
4. Run API and open `/api/meta/ghostmarket`.
5. Ensure compatibility is `true` (or resolve reported reasons).
6. Use generated GhostMarket links to verify listing pages.

## 7. Rust Dialect Limitation

Rust contract currently runs under integer-reference ABI semantics for exported calls in this project.

Implications:

- Core issuance/management flows work for platform-controlled UX, and account parameters can run with witness checks when Hash160 values are provided through the bridge.
- Marketplace-level typed ABI expectations may still be partial for legacy integer-ref calls.
- For marketplace-first production listing, use the C# or Solidity implementation.
