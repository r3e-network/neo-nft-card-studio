use neo_devpack::prelude::*;

use crate::constants::*;
use crate::helpers::*;
use crate::keys::*;
use crate::storage_helpers::*;
use crate::MultiTenantNftPlatformRust;

#[neo_contract]
impl MultiTenantNftPlatformRust {
    #[neo_method(
        name = "createCollection",
        param_types = [
            "Hash160",
            "Integer",
            "Integer",
            "Integer",
            "Integer",
            "Integer",
            "Integer",
            "Boolean"
        ]
    )]
    pub fn create_collection(
        creator: i64,
        name_ref: i64,
        symbol_ref: i64,
        description_ref: i64,
        base_uri_ref: i64,
        max_supply: i64,
        royalty_bps: i64,
        transferable: bool,
    ) -> i64 {
        if creator <= 0 || max_supply < 0 || royalty_bps < 0 || royalty_bps > 10000 {
            return 0;
        }

        let name = string_ref(name_ref);
        let symbol = string_ref(symbol_ref);
        let description = string_ref(description_ref);
        let base_uri = string_ref(base_uri_ref);
        if name.as_str().is_empty()
            || name.len() > 80
            || symbol.as_str().is_empty()
            || symbol.len() > 12
            || description.len() > 512
            || base_uri.as_str().is_empty()
            || base_uri.len() > 512
        {
            return 0;
        }

        let Some(storage) = storage_context() else {
            return 0;
        };

        let creator_id = canonical_account_id(&storage, creator);
        if creator_id <= 0 || !check_witness_for_account_ref(&storage, creator) {
            return 0;
        }

        if read_i64(&storage, &owner_collection_key(creator_id)) > 0 {
            return 0;
        }

        let collection_id = read_i64(&storage, KEY_COLLECTION_COUNTER) + 1;

        if !write_i64(&storage, KEY_COLLECTION_COUNTER, collection_id)
            || !write_i64(&storage, &collection_field_key(collection_id, FIELD_OWNER), creator_id)
            || !write_string_field(&storage, &collection_field_key(collection_id, FIELD_NAME_REF), &name)
            || !write_string_field(&storage, &collection_field_key(collection_id, FIELD_SYMBOL_REF), &symbol)
            || !write_string_field(
                &storage,
                &collection_field_key(collection_id, FIELD_DESC_REF),
                &description,
            )
            || !write_string_field(
                &storage,
                &collection_field_key(collection_id, FIELD_BASE_URI_REF),
                &base_uri,
            )
            || !write_i64(
                &storage,
                &collection_field_key(collection_id, FIELD_MAX_SUPPLY),
                max_supply,
            )
            || !write_i64(&storage, &collection_field_key(collection_id, FIELD_MINTED), 0)
            || !write_i64(
                &storage,
                &collection_field_key(collection_id, FIELD_ROYALTY_BPS),
                royalty_bps,
            )
            || !write_bool(
                &storage,
                &collection_field_key(collection_id, FIELD_TRANSFERABLE),
                transferable,
            )
            || !write_bool(&storage, &collection_field_key(collection_id, FIELD_PAUSED), false)
            || !write_i64(&storage, &collection_field_key(collection_id, FIELD_CREATED_AT), now())
            || !write_i64(&storage, &collection_serial_key(collection_id), 0)
            || !write_i64(&storage, &owner_collection_key(creator_id), collection_id)
        {
            return 0;
        }

        emit_collection_upserted(&storage, collection_id);
        collection_id
    }

    #[neo_method(
        name = "updateCollection",
        param_types = [
            "Hash160",
            "ByteArray",
            "Integer",
            "Integer",
            "Integer",
            "Boolean",
            "Boolean"
        ]
    )]
    pub fn update_collection(
        creator: i64,
        collection_id: i64,
        description_ref: i64,
        base_uri_ref: i64,
        royalty_bps: i64,
        transferable: bool,
        paused: bool,
    ) -> bool {
        if creator <= 0 || collection_id <= 0 || royalty_bps < 0 || royalty_bps > 10000 {
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

        let description = string_ref(description_ref);
        let base_uri = string_ref(base_uri_ref);
        if description.len() > 512 || base_uri.len() > 512 {
            return false;
        }

        let updated = write_string_field(
            &storage,
            &collection_field_key(collection_id, FIELD_DESC_REF),
            &description,
        ) && write_string_field(
            &storage,
            &collection_field_key(collection_id, FIELD_BASE_URI_REF),
            &base_uri,
        ) && write_i64(
            &storage,
            &collection_field_key(collection_id, FIELD_ROYALTY_BPS),
            royalty_bps,
        ) && write_bool(
            &storage,
            &collection_field_key(collection_id, FIELD_TRANSFERABLE),
            transferable,
        ) && write_bool(&storage, &collection_field_key(collection_id, FIELD_PAUSED), paused)
        ;

        if updated {
            emit_collection_upserted(&storage, collection_id);
        }

        updated
    }

    #[neo_method(
        name = "setCollectionOperator",
        param_types = ["Hash160", "ByteArray", "Hash160", "Boolean"]
    )]
    pub fn set_collection_operator(creator: i64, collection_id: i64, operator: i64, enabled: bool) -> bool {
        if creator <= 0 || operator <= 0 || collection_id <= 0 {
            return false;
        }

        let Some(storage) = storage_context() else {
            return false;
        };

        let creator_id = canonical_account_id(&storage, creator);
        let operator_id = canonical_account_id(&storage, operator);
        if creator_id <= 0 || operator_id <= 0 || !check_witness_for_account_ref(&storage, creator) {
            return false;
        }

        if !collection_exists(&storage, collection_id) {
            return false;
        }

        let owner = read_i64(&storage, &collection_field_key(collection_id, FIELD_OWNER));
        if owner != creator_id {
            return false;
        }

        let updated = write_bool(&storage, &operator_key(collection_id, operator_id), enabled);
        if updated {
            emit_collection_operator_updated(&storage, collection_id, operator_id, enabled);
        }
        updated
    }

    #[neo_method(name = "isCollectionOperator", safe, param_types = ["ByteArray", "Hash160"])]
    pub fn is_collection_operator(collection_id: i64, operator: i64) -> bool {
        if collection_id <= 0 || operator <= 0 {
            return false;
        }

        let Some(storage) = storage_context() else {
            return false;
        };

        let operator_id = canonical_account_id(&storage, operator);
        if operator_id <= 0 {
            return false;
        }

        read_bool(&storage, &operator_key(collection_id, operator_id))
    }

    #[neo_method(name = "getOwnerDedicatedCollection", safe, param_types = ["Hash160"], return_type = "ByteArray")]
    pub fn get_owner_dedicated_collection(owner: i64) -> i64 {
        if owner <= 0 {
            return 0;
        }

        let Some(storage) = storage_context() else {
            return 0;
        };

        let owner_id = canonical_account_id(&storage, owner);
        if owner_id <= 0 {
            return 0;
        }

        let collection_id = read_i64(&storage, &owner_collection_key(owner_id));
        if collection_id <= 0 {
            return 0;
        }

        neo_devpack::abi::i64_from_bytes(&neo_devpack::abi::bytes_from_i64(collection_id))
    }

    #[neo_method(name = "hasOwnerDedicatedCollection", safe, param_types = ["Hash160"])]
    pub fn has_owner_dedicated_collection(owner: i64) -> bool {
        if owner <= 0 {
            return false;
        }

        let Some(storage) = storage_context() else {
            return false;
        };

        let owner_id = canonical_account_id(&storage, owner);
        if owner_id <= 0 {
            return false;
        }

        read_i64(&storage, &owner_collection_key(owner_id)) > 0
    }
}
