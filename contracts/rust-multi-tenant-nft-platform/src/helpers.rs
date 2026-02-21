use neo_devpack::prelude::*;

use crate::constants::*;
use crate::keys::*;
use crate::storage_helpers::*;

const FNV_OFFSET_BASIS: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x1000_0000_01b3;

fn fold_bytes_to_i64(bytes: &[u8]) -> i64 {
    if bytes.is_empty() {
        return 0;
    }

    if bytes.len() <= 8 {
        let mut padded = [0u8; 8];
        padded[..bytes.len()].copy_from_slice(bytes);
        return i64::from_le_bytes(padded);
    }

    let mut hash = FNV_OFFSET_BASIS;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(FNV_PRIME);
    }

    if hash == 0 {
        hash = 1;
    }

    i64::from_le_bytes(hash.to_le_bytes())
}

fn normalize_hash160_bytes(bytes: &[u8]) -> NeoByteString {
    let mut normalized = [0u8; 20];
    if bytes.len() >= 20 {
        normalized.copy_from_slice(&bytes[bytes.len() - 20..]);
    } else {
        let start = 20 - bytes.len();
        normalized[start..].copy_from_slice(bytes);
    }

    NeoByteString::from_slice(&normalized)
}

pub fn hash160_bytes_from_ref(account_ref: i64) -> NeoByteString {
    if account_ref <= 0 {
        return NeoByteString::from_slice(&[0u8; 20]);
    }

    let source = neo_devpack::abi::bytes_from_i64(account_ref);
    normalize_hash160_bytes(source.as_slice())
}

pub fn canonical_account_id(storage: &NeoStorageContext, account_ref: i64) -> i64 {
    if account_ref <= 0 {
        return 0;
    }

    match neo_devpack::abi::resolve_value(account_ref) {
        Some(NeoValue::ByteString(account_bytes)) if account_bytes.len() == 20 => {
            let account_id = fold_bytes_to_i64(account_bytes.as_slice());
            if account_id <= 0 {
                return 0;
            }

            let key = account_hash_key(account_id);
            let _ = write_bytes(storage, &key, &account_bytes);
            account_id
        }
        _ => account_ref,
    }
}

pub fn account_hash160(storage: &NeoStorageContext, account_id: i64) -> NeoByteString {
    if account_id <= 0 {
        return NeoByteString::from_slice(&[0u8; 20]);
    }

    let key = account_hash_key(account_id);
    if let Some(stored) = read_bytes(storage, &key) {
        if stored.len() == 20 {
            return stored;
        }
    }

    hash160_bytes_from_ref(account_id)
}

pub fn hash160_value_from_account_id(storage: &NeoStorageContext, account_id: Option<i64>) -> NeoValue {
    match account_id {
        Some(value) if value > 0 => NeoValue::ByteString(account_hash160(storage, value)),
        _ => NeoValue::Null,
    }
}

pub fn hash160_ref_from_account_id(storage: &NeoStorageContext, account_id: i64) -> i64 {
    if account_id <= 0 {
        return 0;
    }
    neo_devpack::abi::i64_from_bytes(&account_hash160(storage, account_id))
}

pub fn write_string_field(storage: &NeoStorageContext, key: &[u8], value: &NeoString) -> bool {
    let bytes = NeoByteString::from_slice(value.as_str().as_bytes());
    write_bytes(storage, key, &bytes)
}

pub fn read_string_field(storage: &NeoStorageContext, key: &[u8]) -> NeoString {
    if let Some(bytes) = read_bytes(storage, key) {
        if let Ok(text) = core::str::from_utf8(bytes.as_slice()) {
            return NeoString::from_str(text);
        }
    }

    // Backward compatibility for older persisted integer-ref layouts.
    string_ref(read_i64(storage, key))
}

pub fn check_witness_for_account_ref(storage: &NeoStorageContext, account_ref: i64) -> bool {
    if account_ref <= 0 {
        return false;
    }

    if let Some(NeoValue::ByteString(account_bytes)) = neo_devpack::abi::resolve_value(account_ref) {
        if account_bytes.len() == 20 {
            return NeoRuntime::check_witness(&account_bytes)
                .map(|flag| flag.as_bool())
                .unwrap_or(false);
        }
    }

    let account_id = canonical_account_id(storage, account_ref);
    if account_id <= 0 {
        return false;
    }

    let key = account_hash_key(account_id);
    if let Some(account_bytes) = read_bytes(storage, &key) {
        if account_bytes.len() == 20 {
            return NeoRuntime::check_witness(&account_bytes)
                .map(|flag| flag.as_bool())
                .unwrap_or(false);
        }
    }

    false
}

pub fn token_id_value(token_id: i64) -> NeoValue {
    NeoValue::ByteString(neo_devpack::abi::bytes_from_i64(token_id))
}

pub fn to_iterator_handle(items: NeoArray<NeoValue>) -> i64 {
    neo_devpack::abi::i64_from_value(&NeoValue::Array(items))
}

pub fn emit_transfer(storage: &NeoStorageContext, from: Option<i64>, to: Option<i64>, token_id: i64) {
    let mut state = NeoArray::new();
    state.push(hash160_value_from_account_id(storage, from));
    state.push(hash160_value_from_account_id(storage, to));
    state.push(NeoValue::Integer(NeoInteger::new(1)));
    state.push(token_id_value(token_id));

    let label = NeoString::from_str("Transfer");
    let _ = NeoRuntime::notify(&label, &state);
}

pub fn emit_collection_upserted(storage: &NeoStorageContext, collection_id: i64) {
    let mut state = NeoArray::new();
    state.push(token_id_value(collection_id));
    state.push(hash160_value_from_account_id(
        storage,
        Some(read_i64(storage, &collection_field_key(collection_id, FIELD_OWNER))),
    ));
    state.push(NeoValue::String(read_string_field(
        storage,
        &collection_field_key(collection_id, FIELD_NAME_REF),
    )));
    state.push(NeoValue::String(read_string_field(
        storage,
        &collection_field_key(collection_id, FIELD_SYMBOL_REF),
    )));
    state.push(NeoValue::String(read_string_field(
        storage,
        &collection_field_key(collection_id, FIELD_DESC_REF),
    )));
    state.push(NeoValue::String(read_string_field(
        storage,
        &collection_field_key(collection_id, FIELD_BASE_URI_REF),
    )));
    state.push(NeoValue::Integer(NeoInteger::new(read_i64(
        storage,
        &collection_field_key(collection_id, FIELD_MAX_SUPPLY),
    ))));
    state.push(NeoValue::Integer(NeoInteger::new(read_i64(
        storage,
        &collection_field_key(collection_id, FIELD_MINTED),
    ))));
    state.push(NeoValue::Integer(NeoInteger::new(read_i64(
        storage,
        &collection_field_key(collection_id, FIELD_ROYALTY_BPS),
    ))));
    state.push(NeoValue::Boolean(NeoBoolean::new(read_bool(
        storage,
        &collection_field_key(collection_id, FIELD_TRANSFERABLE),
    ))));
    state.push(NeoValue::Boolean(NeoBoolean::new(read_bool(
        storage,
        &collection_field_key(collection_id, FIELD_PAUSED),
    ))));
    state.push(NeoValue::Integer(NeoInteger::new(read_i64(
        storage,
        &collection_field_key(collection_id, FIELD_CREATED_AT),
    ))));

    let label = NeoString::from_str("CollectionUpserted");
    let _ = NeoRuntime::notify(&label, &state);
}

pub fn emit_collection_operator_updated(storage: &NeoStorageContext, collection_id: i64, operator_id: i64, enabled: bool) {
    let mut state = NeoArray::new();
    state.push(token_id_value(collection_id));
    state.push(hash160_value_from_account_id(storage, Some(operator_id)));
    state.push(NeoValue::Boolean(NeoBoolean::new(enabled)));

    let label = NeoString::from_str("CollectionOperatorUpdated");
    let _ = NeoRuntime::notify(&label, &state);
}

pub fn emit_token_upserted(storage: &NeoStorageContext, token_id: i64) {
    let collection_id = read_i64(storage, &token_field_key(token_id, TOKEN_FIELD_COLLECTION_ID));
    let owner_id = read_i64(storage, &token_field_key(token_id, TOKEN_FIELD_OWNER));
    let uri = read_string_field(storage, &token_field_key(token_id, TOKEN_FIELD_URI_REF));
    let properties = read_string_field(storage, &token_field_key(token_id, TOKEN_FIELD_PROPERTIES_REF));
    let burned = read_bool(storage, &token_field_key(token_id, TOKEN_FIELD_BURNED));
    let minted_at = read_i64(storage, &token_field_key(token_id, TOKEN_FIELD_MINTED_AT));

    let mut state = NeoArray::new();
    state.push(token_id_value(token_id));
    state.push(NeoValue::ByteString(neo_devpack::abi::bytes_from_i64(collection_id)));
    state.push(hash160_value_from_account_id(storage, Some(owner_id)));
    state.push(NeoValue::String(uri));
    state.push(NeoValue::String(properties));
    state.push(NeoValue::Boolean(NeoBoolean::new(burned)));
    state.push(NeoValue::Integer(NeoInteger::new(minted_at)));

    let label = NeoString::from_str("TokenUpserted");
    let _ = NeoRuntime::notify(&label, &state);
}

pub fn collection_exists(storage: &NeoStorageContext, collection_id: i64) -> bool {
    read_i64(storage, &collection_field_key(collection_id, FIELD_OWNER)) > 0
}

pub fn token_exists(storage: &NeoStorageContext, token_id: i64) -> bool {
    read_i64(storage, &token_field_key(token_id, TOKEN_FIELD_COLLECTION_ID)) > 0
}

pub fn load_balance(storage: &NeoStorageContext, owner: i64) -> i64 {
    read_i64(storage, &balance_key(owner))
}

pub fn save_balance(storage: &NeoStorageContext, owner: i64, value: i64) -> bool {
    write_i64(storage, &balance_key(owner), value)
}

pub fn load_membership_balance(storage: &NeoStorageContext, collection_id: i64, owner: i64) -> i64 {
    read_i64(storage, &membership_balance_key(collection_id, owner))
}

pub fn save_membership_balance(storage: &NeoStorageContext, collection_id: i64, owner: i64, value: i64) -> bool {
    let normalized = if value > 0 { value } else { 0 };
    write_i64(storage, &membership_balance_key(collection_id, owner), normalized)
}

pub fn add_membership_balance(storage: &NeoStorageContext, collection_id: i64, owner: i64, delta: i64) -> bool {
    let current = load_membership_balance(storage, collection_id, owner);
    let next = current.saturating_add(delta);
    save_membership_balance(storage, collection_id, owner, next)
}

pub fn subtract_membership_balance(storage: &NeoStorageContext, collection_id: i64, owner: i64, delta: i64) -> bool {
    let current = load_membership_balance(storage, collection_id, owner);
    let next = if current > delta { current - delta } else { 0 };
    save_membership_balance(storage, collection_id, owner, next)
}

pub fn is_membership_soulbound(storage: &NeoStorageContext, collection_id: i64) -> bool {
    read_bool(
        storage,
        &checkin_program_key(collection_id, CHECKIN_FIELD_MEMBERSHIP_SOULBOUND),
    )
}

pub fn can_manage_collection(storage: &NeoStorageContext, collection_id: i64, actor: i64) -> bool {
    let owner = read_i64(storage, &collection_field_key(collection_id, FIELD_OWNER));
    if owner == actor {
        return true;
    }

    read_bool(storage, &operator_key(collection_id, actor))
}

pub fn collect_active_tokens(
    storage: &NeoStorageContext,
    owner_filter: Option<i64>,
    collection_filter: Option<i64>,
) -> NeoArray<NeoValue> {
    let mut items = NeoArray::new();
    let global_total = read_i64(storage, KEY_GLOBAL_TOKEN_COUNTER);

    let mut cursor = 1;
    while cursor <= global_total {
        let token_id = read_i64(storage, &global_token_key(cursor));
        cursor += 1;

        if token_id <= 0 || !token_exists(storage, token_id) {
            continue;
        }

        if read_bool(storage, &token_field_key(token_id, TOKEN_FIELD_BURNED)) {
            continue;
        }

        if let Some(owner) = owner_filter {
            let token_owner = read_i64(storage, &token_field_key(token_id, TOKEN_FIELD_OWNER));
            if token_owner != owner {
                continue;
            }
        }

        if let Some(collection_id) = collection_filter {
            let token_collection = read_i64(storage, &token_field_key(token_id, TOKEN_FIELD_COLLECTION_ID));
            if token_collection != collection_id {
                continue;
            }
        }

        items.push(token_id_value(token_id));
    }

    items
}

pub fn string_ref(ref_id: i64) -> NeoString {
    neo_devpack::abi::string_from_i64(ref_id)
}

pub fn collection_to_array(storage: &NeoStorageContext, collection_id: i64) -> NeoArray<NeoValue> {
    let mut result = NeoArray::new();
    result.push(NeoValue::ByteString(neo_devpack::abi::bytes_from_i64(collection_id)));
    result.push(hash160_value_from_account_id(storage, Some(read_i64(
        storage,
        &collection_field_key(collection_id, FIELD_OWNER),
    ))));
    result.push(NeoValue::String(read_string_field(
        storage,
        &collection_field_key(collection_id, FIELD_NAME_REF),
    )));
    result.push(NeoValue::String(read_string_field(
        storage,
        &collection_field_key(collection_id, FIELD_SYMBOL_REF),
    )));
    result.push(NeoValue::String(read_string_field(
        storage,
        &collection_field_key(collection_id, FIELD_DESC_REF),
    )));
    result.push(NeoValue::String(read_string_field(
        storage,
        &collection_field_key(collection_id, FIELD_BASE_URI_REF),
    )));
    result.push(NeoValue::Integer(NeoInteger::new(read_i64(
        storage,
        &collection_field_key(collection_id, FIELD_MAX_SUPPLY),
    ))));
    result.push(NeoValue::Integer(NeoInteger::new(read_i64(
        storage,
        &collection_field_key(collection_id, FIELD_MINTED),
    ))));
    result.push(NeoValue::Integer(NeoInteger::new(read_i64(
        storage,
        &collection_field_key(collection_id, FIELD_ROYALTY_BPS),
    ))));
    result.push(NeoValue::Boolean(NeoBoolean::new(read_bool(
        storage,
        &collection_field_key(collection_id, FIELD_TRANSFERABLE),
    ))));
    result.push(NeoValue::Boolean(NeoBoolean::new(read_bool(
        storage,
        &collection_field_key(collection_id, FIELD_PAUSED),
    ))));
    result.push(NeoValue::Integer(NeoInteger::new(read_i64(
        storage,
        &collection_field_key(collection_id, FIELD_CREATED_AT),
    ))));
    result
}

pub fn token_to_array(storage: &NeoStorageContext, token_id: i64) -> NeoArray<NeoValue> {
    let mut result = NeoArray::new();
    result.push(token_id_value(token_id));
    result.push(NeoValue::ByteString(neo_devpack::abi::bytes_from_i64(read_i64(
        storage,
        &token_field_key(token_id, TOKEN_FIELD_COLLECTION_ID),
    ))));
    result.push(hash160_value_from_account_id(storage, Some(read_i64(
        storage,
        &token_field_key(token_id, TOKEN_FIELD_OWNER),
    ))));
    result.push(NeoValue::String(read_string_field(
        storage,
        &token_field_key(token_id, TOKEN_FIELD_URI_REF),
    )));
    result.push(NeoValue::String(read_string_field(
        storage,
        &token_field_key(token_id, TOKEN_FIELD_PROPERTIES_REF),
    )));
    result.push(NeoValue::Boolean(NeoBoolean::new(read_bool(
        storage,
        &token_field_key(token_id, TOKEN_FIELD_BURNED),
    ))));
    result.push(NeoValue::Integer(NeoInteger::new(read_i64(
        storage,
        &token_field_key(token_id, TOKEN_FIELD_MINTED_AT),
    ))));
    result
}

pub fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::from("0x");
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}
