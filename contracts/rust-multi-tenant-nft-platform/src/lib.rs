use neo_devpack::prelude::*;

mod constants;
mod helpers;
mod keys;
mod methods;
mod storage_helpers;

neo_manifest_overlay!(
    r#"{
  "name": "MultiTenantNftPlatformRust",
  "supportedstandards": ["NEP-11", "NEP-24"],
  "features": { "storage": true },
  "abi": {
    "events": [
      {
        "name": "Transfer",
        "parameters": [
          { "name": "from", "type": "Hash160" },
          { "name": "to", "type": "Hash160" },
          { "name": "amount", "type": "Integer" },
          { "name": "tokenId", "type": "ByteArray" }
        ]
      },
      {
        "name": "CollectionUpserted",
        "parameters": [
          { "name": "collectionId", "type": "ByteArray" },
          { "name": "owner", "type": "Hash160" },
          { "name": "name", "type": "String" },
          { "name": "symbol", "type": "String" },
          { "name": "description", "type": "String" },
          { "name": "baseUri", "type": "String" },
          { "name": "maxSupply", "type": "Integer" },
          { "name": "minted", "type": "Integer" },
          { "name": "royaltyBps", "type": "Integer" },
          { "name": "transferable", "type": "Boolean" },
          { "name": "paused", "type": "Boolean" },
          { "name": "createdAt", "type": "Integer" }
        ]
      },
      {
        "name": "TokenUpserted",
        "parameters": [
          { "name": "tokenId", "type": "ByteArray" },
          { "name": "collectionId", "type": "ByteArray" },
          { "name": "owner", "type": "Hash160" },
          { "name": "tokenUri", "type": "String" },
          { "name": "propertiesJson", "type": "String" },
          { "name": "burned", "type": "Boolean" },
          { "name": "mintedAt", "type": "Integer" }
        ]
      },
      {
        "name": "CollectionOperatorUpdated",
        "parameters": [
          { "name": "collectionId", "type": "ByteArray" },
          { "name": "operator", "type": "Hash160" },
          { "name": "enabled", "type": "Boolean" }
        ]
      },
      {
        "name": "DropConfigUpdated",
        "parameters": [
          { "name": "collectionId", "type": "ByteArray" },
          { "name": "enabled", "type": "Boolean" },
          { "name": "startAt", "type": "Integer" },
          { "name": "endAt", "type": "Integer" },
          { "name": "perWalletLimit", "type": "Integer" },
          { "name": "whitelistRequired", "type": "Boolean" }
        ]
      },
      {
        "name": "DropWhitelistUpdated",
        "parameters": [
          { "name": "collectionId", "type": "ByteArray" },
          { "name": "account", "type": "Hash160" },
          { "name": "allowance", "type": "Integer" }
        ]
      },
      {
        "name": "DropClaimed",
        "parameters": [
          { "name": "collectionId", "type": "ByteArray" },
          { "name": "claimer", "type": "Hash160" },
          { "name": "tokenId", "type": "ByteArray" },
          { "name": "claimedCount", "type": "Integer" }
        ]
      },
      {
        "name": "CheckInProgramUpdated",
        "parameters": [
          { "name": "collectionId", "type": "ByteArray" },
          { "name": "enabled", "type": "Boolean" },
          { "name": "membershipRequired", "type": "Boolean" },
          { "name": "membershipSoulbound", "type": "Boolean" },
          { "name": "startAt", "type": "Integer" },
          { "name": "endAt", "type": "Integer" },
          { "name": "intervalSeconds", "type": "Integer" },
          { "name": "maxCheckInsPerWallet", "type": "Integer" },
          { "name": "mintProofNft", "type": "Boolean" }
        ]
      },
      {
        "name": "CheckedIn",
        "parameters": [
          { "name": "collectionId", "type": "ByteArray" },
          { "name": "account", "type": "Hash160" },
          { "name": "checkInCount", "type": "Integer" },
          { "name": "checkedAt", "type": "Integer" },
          { "name": "proofTokenId", "type": "ByteArray" }
        ]
      }
    ]
  }
}"#
);

#[neo_contract]
pub struct MultiTenantNftPlatformRust;

#[neo_contract]
impl MultiTenantNftPlatformRust {
    pub fn new() -> Self {
        Self
    }
}

impl Default for MultiTenantNftPlatformRust {
    fn default() -> Self {
        Self::new()
    }
}
