use neo_devpack::prelude::*;

mod constants;
mod helpers;
mod keys;
mod methods;
mod storage_helpers;

neo_manifest_overlay!(
    r#"{
  "name": "NeoNftMembershipCardRust",
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
