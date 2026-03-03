# Neo NFT Platform - Contract Interface

The platform supports two modes of NFT collection deployment on Neo N3. All collections and tokens are designed to be fully compatible with **GhostMarket**.

## 1. Deployment Modes

### Shared Storefront Mode (Standard)
- **Description**: Your collection metadata is stored on the primary platform contract.
- **Contract**: Multi-tenant NEP-11 platform contract.
- **Cost**: **FREE** (standard network GAS for transaction).
- **Isolation**: Logical isolation via `collectionId`.
- **Best for**: Small creators, rapid launching, and low-cost experimentation.

### Dedicated Contract Mode (Premium)
- **Description**: A new, independent NFT smart contract is deployed from a verified template.
- **Contract**: Per-collection isolated NEP-11 contract.
- **Cost**: **10 GAS** (platform fee) + deployment GAS.
- **Isolation**: Full contract-level isolation with unique contract hash.
- **Best for**: Established brands, games, or projects requiring their own contract identity.

---

## 2. Core Methods

### Collection Management

#### `createCollection` (Shared Mode)
Creates a new collection on the shared platform contract.
- **Parameters**: `name`, `symbol`, `description`, `baseUri`, `maxSupply`, `royaltyBps`, `transferable`.
- **Returns**: `collectionId` (ByteString).

#### `createCollectionAndDeployFromTemplate` (Dedicated Mode)
Creates a collection and deploys a dedicated contract.
- **Parameters**: Same as `createCollection` + `extraData` (object).
- **Fee**: 10 GAS.
- **Returns**: `[collectionId, contractHash]`.

#### `updateCollection`
Updates metadata for an existing collection.
- **Parameters**: `collectionId`, `description`, `baseUri`, `royaltyBps`, `transferable`, `paused`.

---

## 3. GhostMarket Compatibility

All collections deployed via this platform are **GhostMarket Compatible**:

- **Metadata Standard**: Uses NEP-11 and NEP-24 standards.
- **Royalties**: Supports the on-chain royalty standard (`getRoyalties`).
- **Listing**: All items can be listed on GhostMarket or the native platform marketplace.
- **Media**: Optimized for NeoFS and IPFS storage.

---

## 4. Platform Fees
- **Shared Mode**: 0 GAS platform fee.
- **Dedicated Mode**: 10 GAS platform fee (payable at deployment).
- **Marketplace**: 2.5% service fee on successful trades (standard).
