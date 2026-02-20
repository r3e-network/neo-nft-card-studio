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
- `contracts/multi-tenant-nft-platform/MultiTenantNftPlatform.cs`
- `contracts/multi-tenant-nft-platform/MultiTenantNftPlatform.Lifecycle.cs`
- `contracts/multi-tenant-nft-platform/MultiTenantNftPlatform.Collections.cs`
- `contracts/multi-tenant-nft-platform/MultiTenantNftPlatform.Drop.cs`
- `contracts/multi-tenant-nft-platform/MultiTenantNftPlatform.Membership.cs`
- `contracts/multi-tenant-nft-platform/MultiTenantNftPlatform.Tokens.cs`
- `contracts/multi-tenant-nft-platform/MultiTenantNftPlatform.Internal.cs`

Manifest identity:
- `name`: `MultiTenantNftPlatform`
- `supportedstandards`: `NEP-11`, `NEP-24`

Standard:
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

Management:
- `createCollection(...) -> ByteString`
- `createCollectionAndDeployFromTemplate(...) -> object[]` (one-tx create + dedicated contract deployment)
- `updateCollection(...)`
- `setCollectionOperator(...)`
- `isCollectionOperator(...)`
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
- `mint(...) -> ByteString`
- `configureDrop(...)`
- `setDropWhitelist(...)`
- `setDropWhitelistBatch(...)`
- `claimDrop(...) -> ByteString`
- `getDropConfig(...) -> object[]`
- `getDropWalletStats(...) -> object[]`
- `canClaimDrop(...) -> bool`
- `configureCheckInProgram(...)`
- `getCheckInProgram(...) -> object[]`
- `checkIn(...) -> object[]`
- `canCheckIn(...) -> bool`
- `getCheckInWalletStats(...) -> object[]`
- `getMembershipStatus(...) -> object[]`
- `getTokenClass(tokenId) -> BigInteger`
- `burn(tokenId)`
- `getCollection(...) -> object[]`
- `getToken(...) -> object[]`
- `getCollectionTokens(...) -> Iterator`

Runtime deploy semantics:
- Primary mode: shared multi-tenant NFT platform contract.
- Isolation mode: platform owner sets one template (`setCollectionContractTemplate`), then collection owner deploys own dedicated contract instance by config (`deployCollectionContractFromTemplate`).
- Dedicated-user mode: creator can directly execute `createCollectionAndDeployFromTemplate` to ensure one real independent NFT contract is created in the same transaction.
- Dedicated contract hard isolation: runtime stores a bound `collectionId`; all public methods with `collectionId` must match it, and platform-level methods (`createCollection*`, template admin/deploy) are blocked.
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

Type model:
- `collectionId: uint256`
- `tokenId: bytes32`

Semantics are aligned with C# for collection/mint/transfer/burn/operator/query/royalty APIs, and also include lazy mint drop methods:
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
- `name`: `NeoNftMembershipCardRust`
- `supportedstandards`: `NEP-11`, `NEP-24`

Bridge model:
- Runtime uses `i64` ref bridge internally, but exported manifest declares NEP shapes (`Hash160`, `ByteArray`, `Map`, `InteropInterface`) for SDK and integration checks.
- Account parameters support canonical Hash160 mapping and witness checks when Hash160 values are provided via bridge handles.

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
