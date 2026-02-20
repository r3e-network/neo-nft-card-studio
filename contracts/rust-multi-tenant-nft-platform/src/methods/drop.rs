use neo_devpack::prelude::*;

use crate::constants::*;
use crate::helpers::*;
use crate::keys::*;
use crate::methods::token::mint_token_for_account;
use crate::storage_helpers::*;
use crate::MultiTenantNftPlatformRust;

fn emit_drop_config_updated(
    collection_id: i64,
    enabled: bool,
    start_at: i64,
    end_at: i64,
    per_wallet_limit: i64,
    whitelist_required: bool,
) {
    let mut state = NeoArray::new();
    state.push(token_id_value(collection_id));
    state.push(NeoValue::Boolean(NeoBoolean::new(enabled)));
    state.push(NeoValue::Integer(NeoInteger::new(start_at)));
    state.push(NeoValue::Integer(NeoInteger::new(end_at)));
    state.push(NeoValue::Integer(NeoInteger::new(per_wallet_limit)));
    state.push(NeoValue::Boolean(NeoBoolean::new(whitelist_required)));
    let label = NeoString::from_str("DropConfigUpdated");
    let _ = NeoRuntime::notify(&label, &state);
}

fn emit_drop_whitelist_updated(storage: &NeoStorageContext, collection_id: i64, account_id: i64, allowance: i64) {
    let mut state = NeoArray::new();
    state.push(token_id_value(collection_id));
    state.push(hash160_value_from_account_id(storage, Some(account_id)));
    state.push(NeoValue::Integer(NeoInteger::new(allowance)));
    let label = NeoString::from_str("DropWhitelistUpdated");
    let _ = NeoRuntime::notify(&label, &state);
}

fn emit_drop_claimed(storage: &NeoStorageContext, collection_id: i64, claimer_id: i64, token_id: i64, claimed: i64) {
    let mut state = NeoArray::new();
    state.push(token_id_value(collection_id));
    state.push(hash160_value_from_account_id(storage, Some(claimer_id)));
    state.push(token_id_value(token_id));
    state.push(NeoValue::Integer(NeoInteger::new(claimed)));
    let label = NeoString::from_str("DropClaimed");
    let _ = NeoRuntime::notify(&label, &state);
}

fn drop_claim_window_open(enabled: bool, start_at: i64, end_at: i64) -> bool {
    if !enabled {
        return false;
    }

    let current = now();
    if start_at > 0 && current < start_at {
        return false;
    }

    if end_at > 0 && current > end_at {
        return false;
    }

    true
}

fn get_drop_config(storage: &NeoStorageContext, collection_id: i64) -> (bool, i64, i64, i64, bool) {
    (
        read_bool(storage, &drop_config_key(collection_id, DROP_FIELD_ENABLED)),
        read_i64(storage, &drop_config_key(collection_id, DROP_FIELD_START_AT)),
        read_i64(storage, &drop_config_key(collection_id, DROP_FIELD_END_AT)),
        read_i64(storage, &drop_config_key(collection_id, DROP_FIELD_PER_WALLET_LIMIT)),
        read_bool(storage, &drop_config_key(collection_id, DROP_FIELD_WHITELIST_REQUIRED)),
    )
}

fn set_drop_config(
    storage: &NeoStorageContext,
    collection_id: i64,
    enabled: bool,
    start_at: i64,
    end_at: i64,
    per_wallet_limit: i64,
    whitelist_required: bool,
) -> bool {
    write_bool(storage, &drop_config_key(collection_id, DROP_FIELD_ENABLED), enabled)
        && write_i64(storage, &drop_config_key(collection_id, DROP_FIELD_START_AT), start_at)
        && write_i64(storage, &drop_config_key(collection_id, DROP_FIELD_END_AT), end_at)
        && write_i64(
            storage,
            &drop_config_key(collection_id, DROP_FIELD_PER_WALLET_LIMIT),
            per_wallet_limit,
        )
        && write_bool(
            storage,
            &drop_config_key(collection_id, DROP_FIELD_WHITELIST_REQUIRED),
            whitelist_required,
        )
}

fn remaining_drop_claims(storage: &NeoStorageContext, collection_id: i64, account_id: i64) -> i64 {
    let (enabled, _, _, per_wallet_limit, whitelist_required) = get_drop_config(storage, collection_id);
    if !enabled {
        return 0;
    }

    let minted = read_i64(storage, &collection_field_key(collection_id, FIELD_MINTED));
    let max_supply = read_i64(storage, &collection_field_key(collection_id, FIELD_MAX_SUPPLY));
    let mut has_finite_cap = false;
    let mut remaining: i64 = 0;
    if max_supply > 0 {
        if minted >= max_supply {
            return 0;
        }

        remaining = max_supply - minted;
        has_finite_cap = true;
    }

    let claimed = read_i64(storage, &drop_claimed_key(collection_id, account_id));

    if per_wallet_limit > 0 {
        if claimed >= per_wallet_limit {
            return 0;
        }

        let wallet_remaining = per_wallet_limit - claimed;
        if !has_finite_cap || wallet_remaining < remaining {
            remaining = wallet_remaining;
            has_finite_cap = true;
        }
    }

    if whitelist_required {
        let allowance = read_i64(storage, &drop_whitelist_key(collection_id, account_id));
        if allowance <= 0 || claimed >= allowance {
            return 0;
        }

        let whitelist_remaining = allowance - claimed;
        if !has_finite_cap || whitelist_remaining < remaining {
            remaining = whitelist_remaining;
            has_finite_cap = true;
        }
    }

    if !has_finite_cap {
        return i64::MAX;
    }

    remaining
}

#[neo_contract]
impl MultiTenantNftPlatformRust {
    #[neo_method(
        name = "configureDrop",
        param_types = ["Hash160", "ByteArray", "Boolean", "Integer", "Integer", "Integer", "Boolean"]
    )]
    pub fn configure_drop(
        creator: i64,
        collection_id: i64,
        enabled: bool,
        start_at: i64,
        end_at: i64,
        per_wallet_limit: i64,
        whitelist_required: bool,
    ) -> bool {
        if creator <= 0 || collection_id <= 0 || start_at < 0 || end_at < 0 || per_wallet_limit < 0 {
            return false;
        }

        if end_at > 0 && start_at > 0 && end_at <= start_at {
            return false;
        }

        let Some(storage) = storage_context() else {
            return false;
        };

        let creator_id = canonical_account_id(&storage, creator);
        if creator_id <= 0 || !check_witness_for_account_ref(&storage, creator) {
            return false;
        }

        if !collection_exists(&storage, collection_id) {
            return false;
        }

        let owner = read_i64(&storage, &collection_field_key(collection_id, FIELD_OWNER));
        if owner != creator_id {
            return false;
        }

        if !set_drop_config(
            &storage,
            collection_id,
            enabled,
            start_at,
            end_at,
            per_wallet_limit,
            whitelist_required,
        ) {
            return false;
        }

        emit_drop_config_updated(
            collection_id,
            enabled,
            start_at,
            end_at,
            per_wallet_limit,
            whitelist_required,
        );
        true
    }

    #[neo_method(
        name = "setDropWhitelist",
        param_types = ["Hash160", "ByteArray", "Hash160", "Integer"]
    )]
    pub fn set_drop_whitelist(creator: i64, collection_id: i64, account: i64, allowance: i64) -> bool {
        if creator <= 0 || collection_id <= 0 || account <= 0 || allowance < 0 {
            return false;
        }

        let Some(storage) = storage_context() else {
            return false;
        };

        let creator_id = canonical_account_id(&storage, creator);
        let account_id = canonical_account_id(&storage, account);
        if creator_id <= 0 || account_id <= 0 || !check_witness_for_account_ref(&storage, creator) {
            return false;
        }

        if !collection_exists(&storage, collection_id) {
            return false;
        }

        let owner = read_i64(&storage, &collection_field_key(collection_id, FIELD_OWNER));
        if owner != creator_id {
            return false;
        }

        if !write_i64(&storage, &drop_whitelist_key(collection_id, account_id), allowance) {
            return false;
        }

        emit_drop_whitelist_updated(&storage, collection_id, account_id, allowance);
        true
    }

    #[neo_method(
        name = "setDropWhitelistBatch",
        param_types = ["Hash160", "ByteArray", "Any", "Any"]
    )]
    pub fn set_drop_whitelist_batch(
        creator: i64,
        collection_id: i64,
        accounts_ref: i64,
        allowances_ref: i64,
    ) -> bool {
        if creator <= 0 || collection_id <= 0 {
            return false;
        }

        let Some(storage) = storage_context() else {
            return false;
        };

        let creator_id = canonical_account_id(&storage, creator);
        if creator_id <= 0 || !check_witness_for_account_ref(&storage, creator) {
            return false;
        }

        if !collection_exists(&storage, collection_id) {
            return false;
        }

        let owner = read_i64(&storage, &collection_field_key(collection_id, FIELD_OWNER));
        if owner != creator_id {
            return false;
        }

        let Some(NeoValue::Array(accounts)) = neo_devpack::abi::resolve_value(accounts_ref) else {
            return false;
        };
        let Some(NeoValue::Array(allowances)) = neo_devpack::abi::resolve_value(allowances_ref) else {
            return false;
        };

        if accounts.len() != allowances.len() || accounts.len() > 500 {
            return false;
        }

        let mut index = 0usize;
        while index < accounts.len() {
            let Some(account_value) = accounts.get(index) else {
                return false;
            };
            let Some(allowance_value) = allowances.get(index) else {
                return false;
            };

            let account_ref = neo_devpack::abi::i64_from_value(account_value);
            let allowance = neo_devpack::abi::i64_from_value(allowance_value);
            if account_ref <= 0 || allowance < 0 {
                return false;
            }

            let account_id = canonical_account_id(&storage, account_ref);
            if account_id <= 0 {
                return false;
            }

            if !write_i64(&storage, &drop_whitelist_key(collection_id, account_id), allowance) {
                return false;
            }

            emit_drop_whitelist_updated(&storage, collection_id, account_id, allowance);
            index += 1;
        }

        true
    }

    #[neo_method(
        name = "claimDrop",
        param_types = ["Hash160", "ByteArray", "Integer", "Integer"]
    )]
    pub fn claim_drop(claimer: i64, collection_id: i64, token_uri_ref: i64, properties_ref: i64) -> i64 {
        if claimer <= 0 || collection_id <= 0 {
            return 0;
        }

        let Some(storage) = storage_context() else {
            return 0;
        };

        let claimer_id = canonical_account_id(&storage, claimer);
        if claimer_id <= 0 || !check_witness_for_account_ref(&storage, claimer) {
            return 0;
        }

        if !collection_exists(&storage, collection_id) {
            return 0;
        }

        let (enabled, start_at, end_at, per_wallet_limit, whitelist_required) = get_drop_config(&storage, collection_id);
        if !enabled || !drop_claim_window_open(enabled, start_at, end_at) {
            return 0;
        }

        if read_bool(&storage, &collection_field_key(collection_id, FIELD_PAUSED)) {
            return 0;
        }

        let claimed = read_i64(&storage, &drop_claimed_key(collection_id, claimer_id));
        if per_wallet_limit > 0 && claimed >= per_wallet_limit {
            return 0;
        }

        if whitelist_required {
            let allowance = read_i64(&storage, &drop_whitelist_key(collection_id, claimer_id));
            if allowance <= 0 || claimed >= allowance {
                return 0;
            }
        }

        let token_id = mint_token_for_account(
            &storage,
            collection_id,
            claimer_id,
            token_uri_ref,
            properties_ref,
            TOKEN_CLASS_MEMBERSHIP,
        );
        if token_id <= 0 {
            return 0;
        }

        let next_claimed = claimed + 1;
        if !write_i64(&storage, &drop_claimed_key(collection_id, claimer_id), next_claimed) {
            return 0;
        }

        emit_drop_claimed(&storage, collection_id, claimer_id, token_id, next_claimed);
        token_id
    }

    #[neo_method(name = "getDropConfig", safe, param_types = ["ByteArray"], return_type = "Array")]
    pub fn get_drop_config(collection_id: i64) -> i64 {
        if collection_id <= 0 {
            return 0;
        }

        let Some(storage) = storage_context() else {
            return 0;
        };

        if !collection_exists(&storage, collection_id) {
            return 0;
        }

        let (enabled, start_at, end_at, per_wallet_limit, whitelist_required) = get_drop_config(&storage, collection_id);
        let mut result = NeoArray::new();
        result.push(NeoValue::Boolean(NeoBoolean::new(enabled)));
        result.push(NeoValue::Integer(NeoInteger::new(start_at)));
        result.push(NeoValue::Integer(NeoInteger::new(end_at)));
        result.push(NeoValue::Integer(NeoInteger::new(per_wallet_limit)));
        result.push(NeoValue::Boolean(NeoBoolean::new(whitelist_required)));
        to_iterator_handle(result)
    }

    #[neo_method(
        name = "getDropWalletStats",
        safe,
        param_types = ["ByteArray", "Hash160"],
        return_type = "Array"
    )]
    pub fn get_drop_wallet_stats(collection_id: i64, account: i64) -> i64 {
        if collection_id <= 0 || account <= 0 {
            return 0;
        }

        let Some(storage) = storage_context() else {
            return 0;
        };

        let account_id = canonical_account_id(&storage, account);
        if account_id <= 0 || !collection_exists(&storage, collection_id) {
            return 0;
        }

        let (enabled, start_at, end_at, _, whitelist_required) = get_drop_config(&storage, collection_id);
        let claimed = read_i64(&storage, &drop_claimed_key(collection_id, account_id));
        let allowance = if whitelist_required {
            read_i64(&storage, &drop_whitelist_key(collection_id, account_id))
        } else {
            -1
        };
        let remaining = remaining_drop_claims(&storage, collection_id, account_id);
        let claimable_now = enabled
            && drop_claim_window_open(enabled, start_at, end_at)
            && !read_bool(&storage, &collection_field_key(collection_id, FIELD_PAUSED))
            && remaining > 0;

        let mut result = NeoArray::new();
        result.push(NeoValue::Integer(NeoInteger::new(claimed)));
        result.push(NeoValue::Integer(NeoInteger::new(allowance)));
        result.push(NeoValue::Integer(NeoInteger::new(remaining)));
        result.push(NeoValue::Boolean(NeoBoolean::new(claimable_now)));
        to_iterator_handle(result)
    }

    #[neo_method(name = "canClaimDrop", safe, param_types = ["ByteArray", "Hash160"])]
    pub fn can_claim_drop(collection_id: i64, account: i64) -> bool {
        if collection_id <= 0 || account <= 0 {
            return false;
        }

        let Some(storage) = storage_context() else {
            return false;
        };

        let account_id = canonical_account_id(&storage, account);
        if account_id <= 0 || !collection_exists(&storage, collection_id) {
            return false;
        }

        let (enabled, start_at, end_at, _, _) = get_drop_config(&storage, collection_id);
        enabled
            && drop_claim_window_open(enabled, start_at, end_at)
            && !read_bool(&storage, &collection_field_key(collection_id, FIELD_PAUSED))
            && remaining_drop_claims(&storage, collection_id, account_id) > 0
    }
}
