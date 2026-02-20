use neo_devpack::prelude::*;

use crate::constants::*;
use crate::helpers::*;
use crate::keys::*;
use crate::storage_helpers::*;
use crate::MultiTenantNftPlatformRust;

#[neo_contract]
impl MultiTenantNftPlatformRust {
    #[neo_method(name = "tokens", safe, return_type = "InteropInterface")]
    pub fn tokens() -> i64 {
        let Some(storage) = storage_context() else {
            return 0;
        };

        to_iterator_handle(collect_active_tokens(&storage, None, None))
    }

    #[neo_method(name = "tokenByIndex", safe, return_type = "ByteArray")]
    pub fn token_by_index(index: i64) -> i64 {
        if index <= 0 {
            return 0;
        }

        let Some(storage) = storage_context() else {
            return 0;
        };

        let total = read_i64(&storage, KEY_GLOBAL_TOKEN_COUNTER);
        if index > total {
            return 0;
        }

        neo_devpack::abi::i64_from_bytes(&neo_devpack::abi::bytes_from_i64(read_i64(
            &storage,
            &global_token_key(index),
        )))
    }

    #[neo_method(
        name = "tokensOf",
        safe,
        param_types = ["Hash160"],
        return_type = "InteropInterface"
    )]
    pub fn tokens_of(owner: i64) -> i64 {
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

        to_iterator_handle(collect_active_tokens(&storage, Some(owner_id), None))
    }

    #[neo_method(
        name = "tokenOfByIndex",
        safe,
        param_types = ["Hash160", "Integer"],
        return_type = "ByteArray"
    )]
    pub fn token_of_by_index(owner: i64, index: i64) -> i64 {
        if owner <= 0 || index <= 0 {
            return 0;
        }

        let Some(storage) = storage_context() else {
            return 0;
        };

        let owner_id = canonical_account_id(&storage, owner);
        if owner_id <= 0 {
            return 0;
        }

        let tokens = collect_active_tokens(&storage, Some(owner_id), None);
        let target = (index - 1) as usize;
        tokens
            .get(target)
            .and_then(|value| value.as_byte_string().cloned())
            .map(|token_id| neo_devpack::abi::i64_from_bytes(&token_id))
            .unwrap_or(0)
    }

    #[neo_method(
        name = "getCollectionTokens",
        safe,
        param_types = ["ByteArray"],
        return_type = "InteropInterface"
    )]
    pub fn get_collection_tokens(collection_id: i64) -> i64 {
        if collection_id <= 0 {
            return 0;
        }

        let Some(storage) = storage_context() else {
            return 0;
        };

        to_iterator_handle(collect_active_tokens(&storage, None, Some(collection_id)))
    }

    #[neo_method(
        name = "getCollectionTokenBySerial",
        safe,
        param_types = ["ByteArray", "Integer"],
        return_type = "ByteArray"
    )]
    pub fn get_collection_token_by_serial(collection_id: i64, serial: i64) -> i64 {
        if collection_id <= 0 || serial <= 0 {
            return 0;
        }

        let Some(storage) = storage_context() else {
            return 0;
        };

        let token_id = read_i64(&storage, &collection_token_key(collection_id, serial));
        if token_id <= 0 {
            return 0;
        }

        neo_devpack::abi::i64_from_bytes(&neo_devpack::abi::bytes_from_i64(token_id))
    }

    #[neo_method(name = "getCollection", safe, param_types = ["ByteArray"], return_type = "Array")]
    pub fn get_collection(collection_id: i64) -> i64 {
        if collection_id <= 0 {
            return 0;
        }

        let Some(storage) = storage_context() else {
            return 0;
        };

        if !collection_exists(&storage, collection_id) {
            return 0;
        }

        to_iterator_handle(collection_to_array(&storage, collection_id))
    }

    #[neo_method(name = "getCollectionField", safe, param_types = ["ByteArray", "Integer"])]
    pub fn get_collection_field(collection_id: i64, field_code: i64) -> i64 {
        if collection_id <= 0 {
            return 0;
        }

        let Some(storage) = storage_context() else {
            return 0;
        };

        if !collection_exists(&storage, collection_id) {
            return 0;
        }

        match field_code {
            1 => hash160_ref_from_account_id(
                &storage,
                read_i64(&storage, &collection_field_key(collection_id, FIELD_OWNER)),
            ),
            2 => read_i64(&storage, &collection_field_key(collection_id, FIELD_NAME_REF)),
            3 => read_i64(&storage, &collection_field_key(collection_id, FIELD_SYMBOL_REF)),
            4 => read_i64(&storage, &collection_field_key(collection_id, FIELD_DESC_REF)),
            5 => read_i64(&storage, &collection_field_key(collection_id, FIELD_BASE_URI_REF)),
            6 => read_i64(&storage, &collection_field_key(collection_id, FIELD_MAX_SUPPLY)),
            7 => read_i64(&storage, &collection_field_key(collection_id, FIELD_MINTED)),
            8 => read_i64(&storage, &collection_field_key(collection_id, FIELD_ROYALTY_BPS)),
            9 => {
                if read_bool(&storage, &collection_field_key(collection_id, FIELD_TRANSFERABLE)) {
                    1
                } else {
                    0
                }
            }
            10 => {
                if read_bool(&storage, &collection_field_key(collection_id, FIELD_PAUSED)) {
                    1
                } else {
                    0
                }
            }
            11 => read_i64(&storage, &collection_field_key(collection_id, FIELD_CREATED_AT)),
            _ => 0,
        }
    }

    #[neo_method(name = "getToken", safe, param_types = ["ByteArray"], return_type = "Array")]
    pub fn get_token(token_id: i64) -> i64 {
        if token_id <= 0 {
            return 0;
        }

        let Some(storage) = storage_context() else {
            return 0;
        };

        if !token_exists(&storage, token_id) {
            return 0;
        }

        to_iterator_handle(token_to_array(&storage, token_id))
    }

    #[neo_method(name = "getTokenField", safe, param_types = ["ByteArray", "Integer"])]
    pub fn get_token_field(token_id: i64, field_code: i64) -> i64 {
        if token_id <= 0 {
            return 0;
        }

        let Some(storage) = storage_context() else {
            return 0;
        };

        if !token_exists(&storage, token_id) {
            return 0;
        }

        match field_code {
            1 => read_i64(&storage, &token_field_key(token_id, TOKEN_FIELD_COLLECTION_ID)),
            2 => hash160_ref_from_account_id(
                &storage,
                read_i64(&storage, &token_field_key(token_id, TOKEN_FIELD_OWNER)),
            ),
            3 => read_i64(&storage, &token_field_key(token_id, TOKEN_FIELD_URI_REF)),
            4 => read_i64(&storage, &token_field_key(token_id, TOKEN_FIELD_PROPERTIES_REF)),
            5 => {
                if read_bool(&storage, &token_field_key(token_id, TOKEN_FIELD_BURNED)) {
                    1
                } else {
                    0
                }
            }
            6 => read_i64(&storage, &token_field_key(token_id, TOKEN_FIELD_MINTED_AT)),
            7 => read_i64(&storage, &token_field_key(token_id, TOKEN_FIELD_CLASS)),
            _ => 0,
        }
    }

    #[neo_method(name = "tokenURI", safe, param_types = ["ByteArray"])]
    pub fn token_uri(token_id: i64) -> NeoString {
        let Some(storage) = storage_context() else {
            return NeoString::from_str("");
        };

        if !token_exists(&storage, token_id) {
            return NeoString::from_str("");
        }

        string_ref(read_i64(&storage, &token_field_key(token_id, TOKEN_FIELD_URI_REF)))
    }

    #[neo_method(
        name = "properties",
        safe,
        param_types = ["ByteArray"],
        return_type = "Map"
    )]
    pub fn properties(token_id: i64) -> NeoValue {
        let Some(storage) = storage_context() else {
            return NeoValue::Map(NeoMap::new());
        };

        if !token_exists(&storage, token_id) {
            return NeoValue::Map(NeoMap::new());
        }

        let collection_id = read_i64(&storage, &token_field_key(token_id, TOKEN_FIELD_COLLECTION_ID));
        let owner = read_i64(&storage, &token_field_key(token_id, TOKEN_FIELD_OWNER));
        let uri_ref = read_i64(&storage, &token_field_key(token_id, TOKEN_FIELD_URI_REF));
        let properties_ref = read_i64(&storage, &token_field_key(token_id, TOKEN_FIELD_PROPERTIES_REF));

        let mut result: NeoMap<NeoValue, NeoValue> = NeoMap::new();
        result.insert(
            NeoValue::String(NeoString::from_str("tokenId")),
            token_id_value(token_id),
        );
        result.insert(
            NeoValue::String(NeoString::from_str("collectionId")),
            NeoValue::ByteString(neo_devpack::abi::bytes_from_i64(collection_id)),
        );
        result.insert(
            NeoValue::String(NeoString::from_str("owner")),
            hash160_value_from_account_id(&storage, Some(owner)),
        );
        result.insert(
            NeoValue::String(NeoString::from_str("tokenURI")),
            NeoValue::String(string_ref(uri_ref)),
        );

        let properties_value = neo_devpack::abi::resolve_value(properties_ref)
            .unwrap_or_else(|| NeoValue::String(string_ref(properties_ref)));
        result.insert(
            NeoValue::String(NeoString::from_str("properties")),
            properties_value,
        );
        result.insert(
            NeoValue::String(NeoString::from_str("tokenClass")),
            NeoValue::Integer(NeoInteger::new(read_i64(
                &storage,
                &token_field_key(token_id, TOKEN_FIELD_CLASS),
            ))),
        );

        NeoValue::Map(result)
    }

    #[neo_method(name = "getRoyalties", safe, param_types = ["ByteArray"])]
    pub fn get_royalties(token_id: i64) -> NeoString {
        let Some(storage) = storage_context() else {
            return NeoString::from_str("[]");
        };

        if !token_exists(&storage, token_id) {
            return NeoString::from_str("[]");
        }

        let collection_id = read_i64(&storage, &token_field_key(token_id, TOKEN_FIELD_COLLECTION_ID));
        if collection_id <= 0 {
            return NeoString::from_str("[]");
        }

        let royalty_bps = read_i64(&storage, &collection_field_key(collection_id, FIELD_ROYALTY_BPS));
        if royalty_bps <= 0 {
            return NeoString::from_str("[]");
        }

        let owner = read_i64(&storage, &collection_field_key(collection_id, FIELD_OWNER));
        let owner_hex = hex_encode(account_hash160(&storage, owner).as_slice());
        NeoString::from_str(&format!(
            "[{{\"address\":\"{}\",\"value\":{}}}]",
            owner_hex, royalty_bps
        ))
    }

    #[neo_method(
        name = "royaltyInfo",
        safe,
        param_types = ["ByteArray", "Hash160", "Integer"],
        return_type = "Array"
    )]
    pub fn royalty_info(token_id: i64, _royalty_token_ref: i64, sale_price: i64) -> NeoValue {
        let mut result = NeoArray::new();
        if sale_price <= 0 {
            return NeoValue::Array(result);
        }

        let Some(storage) = storage_context() else {
            return NeoValue::Array(result);
        };

        if !token_exists(&storage, token_id) {
            return NeoValue::Array(result);
        }

        let collection_id = read_i64(&storage, &token_field_key(token_id, TOKEN_FIELD_COLLECTION_ID));
        if collection_id <= 0 {
            return NeoValue::Array(result);
        }

        let royalty_bps = read_i64(&storage, &collection_field_key(collection_id, FIELD_ROYALTY_BPS));
        if royalty_bps <= 0 {
            return NeoValue::Array(result);
        }

        let Some(product) = sale_price.checked_mul(royalty_bps) else {
            return NeoValue::Array(result);
        };

        let owner = read_i64(&storage, &collection_field_key(collection_id, FIELD_OWNER));
        result.push(hash160_value_from_account_id(&storage, Some(owner)));
        result.push(NeoValue::Integer(NeoInteger::new(product / 10000)));
        NeoValue::Array(result)
    }

    #[neo_method(
        name = "onNEP11Payment",
        param_types = ["Hash160", "Integer", "ByteArray", "Any"]
    )]
    pub fn on_nep11_payment(_from: i64, _amount: i64, _token_id: i64, _data_ref: i64) {
        panic!("Receiving NEP-11 is not supported");
    }
}
