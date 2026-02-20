use neo_devpack::prelude::*;

use crate::constants::*;
use crate::helpers::*;
use crate::keys::*;
use crate::storage_helpers::*;
use crate::MultiTenantNftPlatformRust;

pub(crate) fn mint_token_for_account(
    storage: &NeoStorageContext,
    collection_id: i64,
    to_id: i64,
    token_uri_ref: i64,
    properties_ref: i64,
    token_class: i64,
) -> i64 {
    if collection_id <= 0 || to_id <= 0 {
        return 0;
    }

    if !(TOKEN_CLASS_STANDARD..=TOKEN_CLASS_CHECKIN_PROOF).contains(&token_class) {
        return 0;
    }

    if read_bool(storage, &collection_field_key(collection_id, FIELD_PAUSED)) {
        return 0;
    }

    let minted = read_i64(storage, &collection_field_key(collection_id, FIELD_MINTED));
    let max_supply = read_i64(storage, &collection_field_key(collection_id, FIELD_MAX_SUPPLY));
    if max_supply > 0 && minted >= max_supply {
        return 0;
    }

    let serial = read_i64(storage, &collection_serial_key(collection_id)) + 1;
    let token_id = collection_id * TOKEN_SERIAL_FACTOR + serial;
    if token_exists(storage, token_id) {
        return 0;
    }

    let effective_token_uri_ref = if token_uri_ref > 0 {
        token_uri_ref
    } else {
        read_i64(storage, &collection_field_key(collection_id, FIELD_BASE_URI_REF))
    };
    let effective_properties_ref = if properties_ref > 0 {
        properties_ref
    } else {
        read_i64(storage, &collection_field_key(collection_id, FIELD_NAME_REF))
    };

    if !write_i64(storage, &collection_serial_key(collection_id), serial)
        || !write_i64(
            storage,
            &token_field_key(token_id, TOKEN_FIELD_COLLECTION_ID),
            collection_id,
        )
        || !write_i64(storage, &token_field_key(token_id, TOKEN_FIELD_OWNER), to_id)
        || !write_i64(
            storage,
            &token_field_key(token_id, TOKEN_FIELD_URI_REF),
            effective_token_uri_ref,
        )
        || !write_i64(
            storage,
            &token_field_key(token_id, TOKEN_FIELD_PROPERTIES_REF),
            effective_properties_ref,
        )
        || !write_bool(storage, &token_field_key(token_id, TOKEN_FIELD_BURNED), false)
        || !write_i64(storage, &token_field_key(token_id, TOKEN_FIELD_MINTED_AT), now())
        || !write_i64(storage, &token_field_key(token_id, TOKEN_FIELD_CLASS), token_class)
        || !write_i64(
            storage,
            &collection_field_key(collection_id, FIELD_MINTED),
            minted + 1,
        )
    {
        return 0;
    }

    let balance = load_balance(storage, to_id);
    if !save_balance(storage, to_id, balance + 1) {
        return 0;
    }

    let total_supply = read_i64(storage, KEY_TOTAL_SUPPLY);
    if !write_i64(storage, KEY_TOTAL_SUPPLY, total_supply + 1) {
        return 0;
    }

    if token_class == TOKEN_CLASS_MEMBERSHIP && !add_membership_balance(storage, collection_id, to_id, 1) {
        return 0;
    }

    let global_counter = read_i64(storage, KEY_GLOBAL_TOKEN_COUNTER) + 1;
    if !write_i64(storage, KEY_GLOBAL_TOKEN_COUNTER, global_counter)
        || !write_i64(storage, &global_token_key(global_counter), token_id)
        || !write_i64(storage, &collection_token_key(collection_id, serial), token_id)
    {
        return 0;
    }

    emit_transfer(storage, None, Some(to_id), token_id);
    token_id
}

#[neo_contract]
impl MultiTenantNftPlatformRust {
    #[neo_method(
        name = "mint",
        param_types = ["Hash160", "ByteArray", "Hash160", "Integer", "Integer"]
    )]
    pub fn mint(operator: i64, collection_id: i64, to: i64, token_uri_ref: i64, properties_ref: i64) -> i64 {
        if operator <= 0 || collection_id <= 0 || to <= 0 {
            return 0;
        }

        let Some(storage) = storage_context() else {
            return 0;
        };

        let operator_id = canonical_account_id(&storage, operator);
        let to_id = canonical_account_id(&storage, to);
        if operator_id <= 0 || to_id <= 0 || !check_witness_for_account_ref(&storage, operator) {
            return 0;
        }

        if !collection_exists(&storage, collection_id) || !can_manage_collection(&storage, collection_id, operator_id)
        {
            return 0;
        }

        mint_token_for_account(
            &storage,
            collection_id,
            to_id,
            token_uri_ref,
            properties_ref,
            TOKEN_CLASS_MEMBERSHIP,
        )
    }

    #[neo_method(name = "burn", param_types = ["Hash160", "ByteArray"])]
    pub fn burn(operator: i64, token_id: i64) -> bool {
        if operator <= 0 || token_id <= 0 {
            return false;
        }

        let Some(storage) = storage_context() else {
            return false;
        };

        let operator_id = canonical_account_id(&storage, operator);
        if operator_id <= 0 || !check_witness_for_account_ref(&storage, operator) {
            return false;
        }

        if !token_exists(&storage, token_id) {
            return false;
        }

        if read_bool(&storage, &token_field_key(token_id, TOKEN_FIELD_BURNED)) {
            return false;
        }

        let collection_id = read_i64(&storage, &token_field_key(token_id, TOKEN_FIELD_COLLECTION_ID));
        let token_owner = read_i64(&storage, &token_field_key(token_id, TOKEN_FIELD_OWNER));
        let token_class = read_i64(&storage, &token_field_key(token_id, TOKEN_FIELD_CLASS));

        let authorized = operator_id == token_owner || can_manage_collection(&storage, collection_id, operator_id);
        if !authorized {
            return false;
        }

        if !write_bool(&storage, &token_field_key(token_id, TOKEN_FIELD_BURNED), true) {
            return false;
        }

        let owner_balance = load_balance(&storage, token_owner);
        if owner_balance > 0 && !save_balance(&storage, token_owner, owner_balance - 1) {
            return false;
        }

        let total_supply = read_i64(&storage, KEY_TOTAL_SUPPLY);
        if total_supply > 0 && !write_i64(&storage, KEY_TOTAL_SUPPLY, total_supply - 1) {
            return false;
        }

        if token_class == TOKEN_CLASS_MEMBERSHIP
            && !subtract_membership_balance(&storage, collection_id, token_owner, 1)
        {
            return false;
        }

        emit_transfer(&storage, Some(token_owner), None, token_id);
        true
    }

    #[neo_method(name = "transfer", param_types = ["Hash160", "ByteArray", "Any"])]
    pub fn transfer(to: i64, token_id: i64, _data_ref: i64) -> bool {
        if to <= 0 || token_id <= 0 {
            return false;
        }

        let Some(storage) = storage_context() else {
            return false;
        };

        let to_id = canonical_account_id(&storage, to);
        if to_id <= 0 {
            return false;
        }

        if !token_exists(&storage, token_id) || read_bool(&storage, &token_field_key(token_id, TOKEN_FIELD_BURNED)) {
            return false;
        }

        let collection_id = read_i64(&storage, &token_field_key(token_id, TOKEN_FIELD_COLLECTION_ID));
        let token_class = read_i64(&storage, &token_field_key(token_id, TOKEN_FIELD_CLASS));
        if read_bool(&storage, &collection_field_key(collection_id, FIELD_PAUSED)) {
            return false;
        }

        if !read_bool(&storage, &collection_field_key(collection_id, FIELD_TRANSFERABLE)) {
            return false;
        }

        if token_class == TOKEN_CLASS_MEMBERSHIP && is_membership_soulbound(&storage, collection_id) {
            return false;
        }

        let from = read_i64(&storage, &token_field_key(token_id, TOKEN_FIELD_OWNER));
        if !check_witness_for_account_ref(&storage, from) {
            return false;
        }

        if from == to_id {
            return true;
        }

        let from_balance = load_balance(&storage, from);
        if from_balance > 0 && !save_balance(&storage, from, from_balance - 1) {
            return false;
        }

        let to_balance = load_balance(&storage, to_id);
        if !save_balance(&storage, to_id, to_balance + 1)
            || !write_i64(&storage, &token_field_key(token_id, TOKEN_FIELD_OWNER), to_id)
        {
            return false;
        }

        if token_class == TOKEN_CLASS_MEMBERSHIP
            && (!subtract_membership_balance(&storage, collection_id, from, 1)
                || !add_membership_balance(&storage, collection_id, to_id, 1))
        {
            return false;
        }

        emit_transfer(&storage, Some(from), Some(to_id), token_id);
        true
    }
}
