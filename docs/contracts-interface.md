# Neo NFT会员卡 - Contract Interface Matrix

Shared SDK adapter: `packages/neo-sdk/src/contract-client.ts`

- Uses `dialect` switch (`csharp | solidity | rust`) to build invoke payloads.
- Same UI action (`create/update/setOperator/mint/transfer/burn`) maps to different ABI args per contract implementation.
- C# dialect supports NFT sub-contract template flows:
  - `buildSetCollectionContractTemplateInvoke`
  - `buildClearCollectionContractTemplateInvoke`
  - `buildDeployCollectionContractFromTemplateInvoke`
  - `getCollectionContract` / `hasCollectionContract`

## C# (Primary Production Interface)

Files:
- `contracts/nft-platform-factory/MultiTenantNftPlatform.cs`
- `contracts/nft-platform-factory/MultiTenantNftPlatform.Lifecycle.cs`
- `contracts/nft-platform-factory/MultiTenantNftPlatform.Collections.cs`
- `contracts/nft-platform-factory/MultiTenantNftPlatform.Internal.cs`
- `contracts/multi-tenant-nft-platform/MultiTenantNftPlatform.cs`
- `contracts/multi-tenant-nft-platform/MultiTenantNftPlatform.Lifecycle.cs`
- `contracts/multi-tenant-nft-platform/MultiTenantNftPlatform.Collections.cs`
- `contracts/multi-tenant-nft-platform/MultiTenantNftPlatform.Drop.cs`
- `contracts/multi-tenant-nft-platform/MultiTenantNftPlatform.Membership.cs`
- `contracts/multi-tenant-nft-platform/MultiTenantNftPlatform.Tokens.cs`
- `contracts/multi-tenant-nft-platform/MultiTenantNftPlatform.Internal.cs`

Manifest identity:
- Factory (`MultiTenantNftPlatform`):
  - non-NEP asset contract (no `NEP-11` / `NEP-24` declaration)
  - role: collection creation + template deployment
- Template (`MultiTenantNftTemplate`):
  - `supportedstandards`: `NEP-11`, `NEP-24`
  - `symbol`: `MNFTP`

Template standard surface (NEP):
- `symbol() -> string`
- `decimals() -> byte`
- `totalSupply() -> BigInteger`
- `balanceOf(owner) -> BigInteger`
- `ownerOf(tokenId) -> UInt160`
- `transfer(to, tokenId, data) -> bool`
- `getRoyalties(tokenId) -> string`
- `royaltyInfo(tokenId, royaltyToken, salePrice) -> object[]`
- `tokensOf(owner) -> Iterator`
- `tokens() -> Iterator`
- `properties(tokenId) -> Map<string, object>`

Factory management:
- `createCollection(...) -> ByteString`
- `createCollectionAndDeployFromTemplate(...) -> object[]` (one-tx create + dedicated contract deployment)
- `setCollectionContractTemplate(nef, manifest)` (platform owner only)
- `clearCollectionContractTemplate()` (platform owner only)
- `hasCollectionContractTemplate() -> bool`
- `getCollectionContractTemplateDigest() -> object[]`
- `deployCollectionContractFromTemplate(collectionId, extraData) -> UInt160`
- `getCollectionContract(collectionId) -> UInt160` (`UInt160.Zero` if not deployed)
- `hasCollectionContract(collectionId) -> bool`
- `getOwnerDedicatedCollection(owner) -> ByteString`
- `getOwnerDedicatedCollectionContract(owner) -> UInt160`
- `hasOwnerDedicatedCollectionContract(owner) -> bool`
- `deployCollectionContractFromTemplate` enforces one-owner-one-dedicated-contract binding.

Template runtime management:
- `updateCollection(...)`
- `setCollectionOperator(...)`
- `isCollectionOperator(...)`
- `mint(...) -> ByteString`
- `configureDrop(...)`
- `setDropWhitelist(...)`
- `setDropWhitelistBatch(...)`
- `claimDrop(...) -> ByteString`
- `getDropConfig(...) -> object[]`
- `configureCheckInProgram(...)`
- `getCheckInProgram(...) -> object[]`
- `checkIn(...) -> object[]`
- `initializeDedicatedCollection(...)`
- `burn(tokenId)`
- C# Template intentionally keeps a reduced wallet-query surface (no `getDropWalletStats` / `canClaimDrop` / `getCheckInWalletStats` / `canCheckIn` / `getMembershipStatus` / `getTokenClass`), while keeping NEP-11/NEP-24 runtime methods complete.

Runtime deploy semantics:
- Primary mode: factory contract deploys dedicated NFT template contracts.
- Isolation mode: platform owner sets one template (`setCollectionContractTemplate`), then collection owner deploys own dedicated contract instance by config (`deployCollectionContractFromTemplate`).
- Dedicated-user mode: creator can directly execute `createCollectionAndDeployFromTemplate` to ensure one real independent NFT contract is created in the same transaction.
- Dedicated contract hard isolation: runtime stores a bound `collectionId`; all public methods with `collectionId` must match it, and platform-level methods (`createCollection*`, template admin/deploy) are blocked.
- Dedicated init hardening: `initializeDedicatedCollection` requires both owner witness and configured initializer-contract permission (when set by factory deploy data).
- Deploy hash collision protection: when configuring template, use a unique template manifest `name` per factory deployment (the testnet flow script auto-appends a suffix).
- User side does not need to compile or upload custom `nef/manifest`.

Pause semantics (all dialects):
- when `paused == true`, collection `mint` and `transfer` are rejected.

Supply semantics (all dialects):
- `maxSupply > 0`: finite cap.
- `maxSupply = 0`: unlimited supply mode.

## Solidity (neo-solidity)

Files:
- `contracts/solidity/MultiTenantNftPlatform.sol`
- `contracts/solidity/src/NftStorage.sol`
- `contracts/solidity/src/NftCollectionLogic.sol`
- `contracts/solidity/src/NftTokenLogic.sol`
- `contracts/solidity/src/NftCheckInLogic.sol`
- `contracts/solidity/src/NftQueryLogic.sol`

Contract name:
- `MultiTenantNftPlatform`
- `symbol`: `MNFTP`

Type model:
- `collectionId: uint256`
- `tokenId: bytes32`

Semantics are aligned with C# for collection/mint/transfer/burn/operator/query/royalty APIs, and Solidity also exposes wallet-level drop/membership query helpers:
- `configureDrop`
- `setDropWhitelist`
- `setDropWhitelistBatch`
- `claimDrop`
- `getDropConfig`
- `getDropWalletStats`
- `canClaimDrop`
- `configureCheckInProgram`
- `getCheckInProgram`
- `checkIn`
- `canCheckIn`
- `getCheckInWalletStats`
- `getMembershipStatus`
- `getTokenClass`

## Rust (neo-llvm)

Files:
- `contracts/rust-multi-tenant-nft-platform/src/lib.rs`
- `contracts/rust-multi-tenant-nft-platform/src/constants.rs`
- `contracts/rust-multi-tenant-nft-platform/src/storage_helpers.rs`
- `contracts/rust-multi-tenant-nft-platform/src/keys.rs`
- `contracts/rust-multi-tenant-nft-platform/src/helpers.rs`
- `contracts/rust-multi-tenant-nft-platform/src/methods/core.rs`
- `contracts/rust-multi-tenant-nft-platform/src/methods/collection.rs`
- `contracts/rust-multi-tenant-nft-platform/src/methods/token.rs`
- `contracts/rust-multi-tenant-nft-platform/src/methods/drop.rs`
- `contracts/rust-multi-tenant-nft-platform/src/methods/membership.rs`
- `contracts/rust-multi-tenant-nft-platform/src/methods/query.rs`

Manifest identity:
- `name`: `MultiTenantNftPlatformRust`
- `supportedstandards`: `NEP-11`, `NEP-24`
- `symbol`: `MNFTP`

Bridge model:
- Runtime uses `i64` ref bridge internally, but exported manifest declares NEP shapes (`Hash160`, `ByteArray`, `Map`, `InteropInterface`) for SDK and integration checks.
- Account parameters support canonical Hash160 mapping and witness checks when Hash160 values are provided via bridge handles.
- Collection/token string fields are now persisted as raw UTF-8 bytes (`write_string_field` / `read_string_field`) instead of transient ABI refs.
- Query paths keep backward compatibility for old integer-ref data via `read_string_field` fallback.

Compatibility helpers:
- `tokenByIndex` / `tokenOfByIndex` / `getCollectionField` / `getTokenField` / `getCollectionTokenBySerial`
- lazy mint helpers:
  - `configureDrop`
  - `setDropWhitelist`
  - `setDropWhitelistBatch`
  - `claimDrop`
  - `getDropConfig`
  - `getDropWalletStats`
  - `canClaimDrop`
- membership/check-in helpers:
  - `configureCheckInProgram`
  - `getCheckInProgram`
  - `checkIn`
  - `canCheckIn`
  - `getCheckInWalletStats`
  - `getMembershipStatus`
  - `getTokenClass`

Safety and standards:
- Includes `Transfer(from, to, amount, tokenId)` event (4 params)
- Includes `onNEP11Payment(...)` callback (default reject)
- Keeps legacy integer-ref compatibility for older tooling calls.

## Cross-Version Consistency Audit

Automated checks run in `verify:contracts`:

- `tools/verify-nep-compliance.js`
  - Verifies C# Factory is non-NEP runtime.
  - Verifies C# Template / Solidity / Rust declare and implement NEP-11/NEP-24 method/event shapes.
- `tools/verify-contract-consistency.js`
  - Verifies C# Factory vs Template role split.
  - Verifies C# Template / Solidity / Rust shared method surface (including rust signer-bridge arity rules).
  - Verifies shared event declarations for indexer compatibility.
  - Verifies unified `symbol = MNFTP`.
  - Verifies Solidity query return layout (`getCollection` / `getToken` return ID in first position).
