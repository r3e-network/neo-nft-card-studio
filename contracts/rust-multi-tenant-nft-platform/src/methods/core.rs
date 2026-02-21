use neo_devpack::prelude::*;

use crate::constants::*;
use crate::helpers::*;
use crate::keys::*;
use crate::storage_helpers::*;
use crate::MultiTenantNftPlatformRust;

#[neo_contract]
impl MultiTenantNftPlatformRust {
    #[neo_method(name = "symbol", safe)]
    pub fn symbol() -> NeoString {
        NeoString::from_str("MNFTP")
    }

    #[neo_method(name = "decimals", safe)]
    pub fn decimals() -> i64 {
        0
    }

    #[neo_method(name = "totalSupply", safe)]
    pub fn total_supply() -> i64 {
        let Some(storage) = storage_context() else {
            return 0;
        };

        read_i64(&storage, KEY_TOTAL_SUPPLY)
    }

    #[neo_method(name = "balanceOf", safe, param_types = ["Hash160"])]
    pub fn balance_of(owner: i64) -> i64 {
        let Some(storage) = storage_context() else {
            return 0;
        };

        let account_id = canonical_account_id(&storage, owner);
        if account_id <= 0 {
            return 0;
        }

        load_balance(&storage, account_id)
    }

    #[neo_method(
        name = "ownerOf",
        safe,
        param_types = ["ByteArray"],
        return_type = "Hash160"
    )]
    pub fn owner_of(token_id: i64) -> i64 {
        let Some(storage) = storage_context() else {
            return 0;
        };

        if !token_exists(&storage, token_id) {
            return 0;
        }

        if read_bool(&storage, &token_field_key(token_id, TOKEN_FIELD_BURNED)) {
            return 0;
        }

        let owner_id = read_i64(&storage, &token_field_key(token_id, TOKEN_FIELD_OWNER));
        hash160_ref_from_account_id(&storage, owner_id)
    }
}
