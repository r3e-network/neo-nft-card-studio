# Neo NFT会员卡 (Neo N3 Membership Card NFT Platform)

一个面向 Neo N3 的会员卡/权益卡/签到卡 NFT 批量发行平台，包含：

- 多租户 NFT 平台合约（共享主合约，支持多创作者 Collection）
- 可选模板化子合约部署（用户按配置部署，不需要自行编译 NEF/manifest）
- 链上事件索引 API（供前端和运营系统查询）
- Web 控制台（连接钱包，创建/管理 Collection，配置领取规则，mint/claim/transfer/burn）
- 三套合约实现：`C#`、`Solidity`、`Rust`

## 1. 项目结构

```text
apps/
  api/   # 索引器 + 查询 API
  web/   # 管理控制台
packages/
  neo-sdk/  # 前后端共享的 Neo RPC/合约调用封装
contracts/
  multi-tenant-nft-platform/      # C# (Neo Compiler C#)
  solidity/                       # Solidity (neo-solidity)
  rust-multi-tenant-nft-platform/ # Rust (neo-llvm)
```

## 2. 核心设计

- **默认模式（推荐）**：C# 方言使用工厂式“每用户独立 NFT 合约”发行（无需用户自行编译）。
- **强约束**：C# 路径在合约层强制 `1 钱包 = 1 专属 Collection = 1 独立 NFT 合约`。
- **隔离模式**：模板部署出来的独立合约会自动进入 dedicated mode，仅允许访问绑定的 `collectionId`，并禁止 `createCollection` / 模板管理 / 二次模板部署等平台级操作。
- **兼容模式（可选）**：单合约多租户 NFT 发行，适用于 Solidity / Rust 或低成本场景。
- **关键点**：用户不需要自带编译产物；平台仅保留模板部署路径，不提供用户自定义 NEF/manifest 上传部署入口。
- **网络选择**：前端以钱包当前网络为准（主网/测试网/私链），签名与交易广播由钱包 provider 执行；平台不代替钱包发交易。

核心能力：
- `createCollection` / `updateCollection`
- `createCollectionAndDeployFromTemplate`（一笔交易创建 collection 并部署用户独立合约）
- `setCollectionOperator`
- `mint` / `transfer` / `burn`
- `configureDrop` / `setDropWhitelist` / `setDropWhitelistBatch` / `claimDrop`（懒铸造领取）
- `getDropConfig` / `getDropWalletStats` / `canClaimDrop`
- `configureCheckInProgram` / `checkIn`（签到规则 + 链上签到证明）
- `getCheckInProgram` / `getCheckInWalletStats` / `canCheckIn` / `getMembershipStatus`
- `setCollectionContractTemplate` / `clearCollectionContractTemplate`
- `deployCollectionContractFromTemplate` / `getCollectionContract` / `hasCollectionContract`
- `getOwnerDedicatedCollection` / `getOwnerDedicatedCollectionContract` / `hasOwnerDedicatedCollectionContract`
- `balanceOf` / `ownerOf` / `tokens` / `tokensOf`

风控行为：
- `paused = true` 时禁止 `mint` 与 `transfer`。
- Drop 场景中支持：活动时间窗、单钱包限额、白名单额度。
- `maxSupply = 0` 表示无限发行；可支持十万/百万级会员卡按需领取。
- `batchMint` 的 `100` 仅为单笔交易安全上限，不是项目总量上限。
- 若开启 `mintProofNft`（签到时铸造证明），签到证明 NFT 与当前集合共用供应量；会员卡项目建议 `maxSupply=0`。

懒铸造（推荐给 10 万会员卡发放）：
- 发行方只配置规则，不做一次性大规模上链铸造。
- 真实用户在前端点击“领取”后由自己签名交易，按需写链，节省未领取部分成本。

## 3. 环境变量

```bash
cp .env.example .env
```

关键项：
- `NEO_CONTRACT_DIALECT`: `csharp | solidity | rust`
- `VITE_CONTRACT_DIALECT`: 前端方言，需与后端一致
- API 多网络（同一个 API 实例可同时服务多链环境）：
  - 默认网络：`NEO_DEFAULT_NETWORK=mainnet|testnet|private`
  - 基础配置（默认网络必填）：`NEO_RPC_URL`、`NEO_CONTRACT_HASH`、`DB_FILE`
  - 可选多网络覆盖：`NEO_RPC_URL_MAINNET/TESTNET/PRIVATE`、`NEO_CONTRACT_HASH_MAINNET/TESTNET/PRIVATE`、`DB_FILE_MAINNET/TESTNET/PRIVATE`
  - 查询接口可带 `?network=mainnet|testnet|private`，前端会按钱包网络自动附加
- 前端默认以钱包当前网络为准：连接钱包后自动识别 `mainnet/testnet/private` 并切换对应配置
  - 可选覆盖：`VITE_NEO_RPC_URL_MAINNET/TESTNET/PRIVATE`
  - 可选覆盖：`VITE_NEO_CONTRACT_HASH_MAINNET/TESTNET/PRIVATE`
  - 可选覆盖：`VITE_API_BASE_URL_MAINNET/TESTNET/PRIVATE`
- 读请求说明：合约只读调用默认使用“钱包网络对应 RPC（若钱包暴露 rpcUrl）或该网络预设 RPC”；写请求始终走钱包 `invoke`。
- 主网注意：若钱包在 mainnet，必须提供 `VITE_NEO_CONTRACT_HASH_MAINNET`，否则前端会拒绝执行合约调用（避免误用测试网 hash）。
- `INDEXER_ENABLE_EVENTS`: 是否启用事件索引（`rust` 方言建议按需开启）
- `NEOFS_*`: NeoFS 网关与 URI 解析配置（支持 `neofs://<container>/<object>`）
- `GHOSTMARKET_*`: GhostMarket 链接模板和兼容性检测配置

## 4. 运行前后端

```bash
npm install
npm run dev:api
npm run dev:web
```

- API: `http://localhost:8080/api`
- Web: `http://localhost:5173`
- Web 开发服务器已内置 `/api -> http://localhost:8080` 代理，可通过 `VITE_DEV_API_PROXY_TARGET` 覆盖目标地址。

## 5. 合约编译（指定工具链）

### 5.1 C# (`Neo Compiler 3.9.1`, `net10`)

配置：
- `contracts/multi-tenant-nft-platform/MultiTenantNftPlatform.csproj`
  - `TargetFramework: net10.0`
  - `Neo.SmartContract.Framework: 3.9.1`

构建：

```bash
dotnet build contracts/multi-tenant-nft-platform/MultiTenantNftPlatform.csproj
./tools/nccs contracts/multi-tenant-nft-platform/MultiTenantNftPlatform.csproj \
  -o contracts/multi-tenant-nft-platform/build \
  --base-name MultiTenantNftPlatform \
  --optimize=All --debug=None
```

产物：
- `contracts/multi-tenant-nft-platform/build/MultiTenantNftPlatform.nef`
- `contracts/multi-tenant-nft-platform/build/MultiTenantNftPlatform.manifest.json`

### 5.2 Solidity（使用 `~/git/neo-solidity`）

```bash
cargo run --manifest-path ~/git/neo-solidity/Cargo.toml --bin neo-solc -- \
  contracts/solidity/MultiTenantNftPlatform.sol \
  -I ~/git/neo-solidity/devpack \
  -O2 \
  --contract MultiTenantNftPlatform \
  -o contracts/solidity/build/MultiTenantNftPlatform
```

产物：
- `contracts/solidity/build/MultiTenantNftPlatform.nef`
- `contracts/solidity/build/MultiTenantNftPlatform.manifest.json`

### 5.3 Rust（使用 `~/git/neo-llvm`）

```bash
~/git/neo-llvm/scripts/build_contract.sh \
  contracts/rust-multi-tenant-nft-platform \
  MultiTenantNftPlatformRust
```

产物：
- `contracts/rust-multi-tenant-nft-platform/target/wasm32-unknown-unknown/release/multi_tenant_nft_platform_rust.nef`
- `contracts/rust-multi-tenant-nft-platform/target/wasm32-unknown-unknown/release/multi_tenant_nft_platform_rust.manifest.json`

## 6. NEP 标准声明与校验

- 三套合约均声明并实现：`NEP-11`、`NEP-24`
- 三套合约均包含 `Transfer` 事件（4 参数）与 `onNEP11Payment` 回调
- 合规校验脚本覆盖方法签名、参数类型、返回类型、safe 标记、事件参数
- C# 额外校验“仅模板部署”约束：必须存在模板部署接口，且禁止暴露 `deployCollectionContract`（自定义 NEF/manifest 上传部署）

```bash
npm run verify:contracts
```

## 7. 合约结构重构

### C# partial 拆分

- `MultiTenantNftPlatform.cs`: manifest 属性、事件、常量、状态结构
- `MultiTenantNftPlatform.Lifecycle.cs`: `_deploy/verify/update` 与 NEP 入口
- `MultiTenantNftPlatform.Collections.cs`: collection 管理 + 模板部署接口
- `MultiTenantNftPlatform.Drop.cs`: 懒铸造与白名单领用
- `MultiTenantNftPlatform.Membership.cs`: 会员卡与签到证明逻辑
- `MultiTenantNftPlatform.Tokens.cs`: mint/transfer/burn 与查询
- `MultiTenantNftPlatform.Internal.cs`: storage map、序列化与内部工具

### Solidity 模块拆分

- `contracts/solidity/src/NftStorage.sol`
- `contracts/solidity/src/NftCollectionLogic.sol`
- `contracts/solidity/src/NftTokenLogic.sol`
- `contracts/solidity/src/NftCheckInLogic.sol`
- `contracts/solidity/src/NftQueryLogic.sol`
- 入口：`contracts/solidity/MultiTenantNftPlatform.sol`

### Rust 模块拆分

- `src/constants.rs`
- `src/storage_helpers.rs`
- `src/keys.rs`
- `src/helpers.rs`
- `src/methods/core.rs`
- `src/methods/collection.rs`
- `src/methods/token.rs`
- `src/methods/drop.rs`
- `src/methods/membership.rs`
- `src/methods/query.rs`
- 入口：`src/lib.rs`

## 8. 模板化配置部署（无需用户编译）

推荐流程：
1. 平台 owner 调用 `setCollectionContractTemplate(nef, manifest)` 一次配置模板。
2. 用户直接调用 `createCollectionAndDeployFromTemplate(...)`（推荐），一笔交易完成创建+独立合约部署。
3. 或者先 `createCollection` 再 `deployCollectionContractFromTemplate(collectionId, extraData)`（兼容路径，同样受 `1 钱包 1 专属合约` 约束）。
4. 通过 `getCollectionContract(collectionId)` 或 `getOwnerDedicatedCollectionContract(owner)` 查询已部署 hash。
5. 专属合约内部仅允许绑定集合操作；跨集合 `collectionId` 调用会直接拒绝。

## 9. API 概览

说明：以下接口均支持可选 `?network=mainnet|testnet|private`（不传则使用 `NEO_DEFAULT_NETWORK`）。

- `GET /api/health`
- `GET /api/meta/contract`
- `GET /api/meta/neofs`
- `GET /api/meta/neofs/resolve?uri=<neofs://...>`
- `GET /api/meta/neofs/metadata?uri=<neofs://...>`
- `GET /api/meta/neofs/resource?uri=<neofs://...>`
- `GET /api/meta/ghostmarket`
- `GET /api/meta/ghostmarket/collection/:collectionId`
- `GET /api/meta/ghostmarket/token/:tokenId`
- `GET /api/stats`
- `GET /api/collections`
- `GET /api/collections/:collectionId`
- `GET /api/collections/:collectionId/tokens`
- `GET /api/tokens/:tokenId`
- `GET /api/wallets/:address/tokens`
- `GET /api/transfers`

## 10. 自动化测试

本地全流程（合约编译 + NEP 校验 + SDK 断言 + API smoke）：

```bash
npm run smoke:e2e
```

附加测试网真实交易流（会发交易，覆盖 `create + deploy + mint + configureCheckInProgram + checkIn + transfer + burn`）：

```bash
SMOKE_INCLUDE_TESTNET=true TESTNET_WIF=<your_wif> npm run smoke:e2e
```

或单独运行：

```bash
TESTNET_WIF=<your_wif> npm run test:testnet
```

若使用本仓库 `.env.testnet`：

```bash
set -a; source .env.testnet; set +a; npm run test:testnet
```

说明：
- `testnet-flow` 现在会自动校验 dedicated 合约隔离规则（平台级方法禁止、跨 collectionId 禁止）。
- 若 `TESTNET_DEPLOY_NAME` 重名，脚本会自动追加后缀重试部署，避免因“contract already exists”中断。

## 11. 前端功能

- NeoLine 钱包连接
- 创建 Collection
- Collection 管理：update/operator/mint/template-deploy/transfer/burn
- NeoFS 资源：支持在 `baseUri` / `tokenUri` 中直接填写 `neofs://` 资源；列表中可解析并加载 NeoFS 元数据，并通过 API 代理稳定加载图片/媒体
- Portfolio 资产视图
- 方言切换展示（`csharp/solidity/rust`）
- GhostMarket 兼容状态 + Collection/Token 外链

## 12. 参考文档

- `docs/contracts-interface.md`
- `docs/ghostmarket-integration.md`
- `docs/neofs-integration.md`
