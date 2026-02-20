use neo_devpack::prelude::*;

use crate::constants::*;
use crate::helpers::*;
use crate::keys::*;
use crate::methods::token::mint_token_for_account;
use crate::storage_helpers::*;
use crate::MultiTenantNftPlatformRust;

fn emit_checkin_program_updated(
    collection_id: i64,
    enabled: bool,
    membership_required: bool,
    membership_soulbound: bool,
    start_at: i64,
    end_at: i64,
    interval_seconds: i64,
    max_checkins_per_wallet: i64,
    mint_proof_nft: bool,
) {
    let mut state = NeoArray::new();
    state.push(token_id_value(collection_id));
    state.push(NeoValue::Boolean(NeoBoolean::new(enabled)));
    state.push(NeoValue::Boolean(NeoBoolean::new(membership_required)));
    state.push(NeoValue::Boolean(NeoBoolean::new(membership_soulbound)));
    state.push(NeoValue::Integer(NeoInteger::new(start_at)));
    state.push(NeoValue::Integer(NeoInteger::new(end_at)));
    state.push(NeoValue::Integer(NeoInteger::new(interval_seconds)));
    state.push(NeoValue::Integer(NeoInteger::new(max_checkins_per_wallet)));
    state.push(NeoValue::Boolean(NeoBoolean::new(mint_proof_nft)));

    let label = NeoString::from_str("CheckInProgramUpdated");
    let _ = NeoRuntime::notify(&label, &state);
}

fn emit_checked_in(
    storage: &NeoStorageContext,
    collection_id: i64,
    account_id: i64,
    checkin_count: i64,
    checked_at: i64,
    proof_token_id: i64,
) {
    let mut state = NeoArray::new();
    state.push(token_id_value(collection_id));
    state.push(hash160_value_from_account_id(storage, Some(account_id)));
    state.push(NeoValue::Integer(NeoInteger::new(checkin_count)));
    state.push(NeoValue::Integer(NeoInteger::new(checked_at)));
    if proof_token_id > 0 {
        state.push(token_id_value(proof_token_id));
    } else {
        state.push(NeoValue::ByteString(NeoByteString::from_slice(&[])));
    }

    let label = NeoString::from_str("CheckedIn");
    let _ = NeoRuntime::notify(&label, &state);
}

fn get_checkin_program(storage: &NeoStorageContext, collection_id: i64) -> (bool, bool, bool, i64, i64, i64, i64, bool) {
    (
        read_bool(storage, &checkin_program_key(collection_id, CHECKIN_FIELD_ENABLED)),
        read_bool(
            storage,
            &checkin_program_key(collection_id, CHECKIN_FIELD_MEMBERSHIP_REQUIRED),
        ),
        read_bool(
            storage,
            &checkin_program_key(collection_id, CHECKIN_FIELD_MEMBERSHIP_SOULBOUND),
        ),
        read_i64(storage, &checkin_program_key(collection_id, CHECKIN_FIELD_START_AT)),
        read_i64(storage, &checkin_program_key(collection_id, CHECKIN_FIELD_END_AT)),
        read_i64(
            storage,
            &checkin_program_key(collection_id, CHECKIN_FIELD_INTERVAL_SECONDS),
        ),
        read_i64(
            storage,
            &checkin_program_key(collection_id, CHECKIN_FIELD_MAX_PER_WALLET),
        ),
        read_bool(storage, &checkin_program_key(collection_id, CHECKIN_FIELD_MINT_PROOF_NFT)),
    )
}

fn set_checkin_program(
    storage: &NeoStorageContext,
    collection_id: i64,
    enabled: bool,
    membership_required: bool,
    membership_soulbound: bool,
    start_at: i64,
    end_at: i64,
    interval_seconds: i64,
    max_checkins_per_wallet: i64,
    mint_proof_nft: bool,
) -> bool {
    write_bool(storage, &checkin_program_key(collection_id, CHECKIN_FIELD_ENABLED), enabled)
        && write_bool(
            storage,
            &checkin_program_key(collection_id, CHECKIN_FIELD_MEMBERSHIP_REQUIRED),
            membership_required,
        )
        && write_bool(
            storage,
            &checkin_program_key(collection_id, CHECKIN_FIELD_MEMBERSHIP_SOULBOUND),
            membership_soulbound,
        )
        && write_i64(
            storage,
            &checkin_program_key(collection_id, CHECKIN_FIELD_START_AT),
            start_at,
        )
        && write_i64(
            storage,
            &checkin_program_key(collection_id, CHECKIN_FIELD_END_AT),
            end_at,
        )
        && write_i64(
            storage,
            &checkin_program_key(collection_id, CHECKIN_FIELD_INTERVAL_SECONDS),
            interval_seconds,
        )
        && write_i64(
            storage,
            &checkin_program_key(collection_id, CHECKIN_FIELD_MAX_PER_WALLET),
            max_checkins_per_wallet,
        )
        && write_bool(
            storage,
            &checkin_program_key(collection_id, CHECKIN_FIELD_MINT_PROOF_NFT),
            mint_proof_nft,
        )
}

fn get_checkin_wallet_stats(storage: &NeoStorageContext, collection_id: i64, account_id: i64) -> (i64, i64) {
    (
        read_i64(
            storage,
            &checkin_wallet_key(collection_id, account_id, CHECKIN_WALLET_FIELD_COUNT),
        ),
        read_i64(
            storage,
            &checkin_wallet_key(collection_id, account_id, CHECKIN_WALLET_FIELD_LAST_AT),
        ),
    )
}

fn set_checkin_wallet_stats(
    storage: &NeoStorageContext,
    collection_id: i64,
    account_id: i64,
    checkin_count: i64,
    checked_at: i64,
) -> bool {
    write_i64(
        storage,
        &checkin_wallet_key(collection_id, account_id, CHECKIN_WALLET_FIELD_COUNT),
        checkin_count,
    ) && write_i64(
        storage,
        &checkin_wallet_key(collection_id, account_id, CHECKIN_WALLET_FIELD_LAST_AT),
        checked_at,
    )
}

fn checkin_window_open(enabled: bool, start_at: i64, end_at: i64) -> bool {
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

fn can_checkin_now(storage: &NeoStorageContext, collection_id: i64, account_id: i64) -> bool {
    let (enabled, membership_required, _, start_at, end_at, interval_seconds, max_per_wallet, _) =
        get_checkin_program(storage, collection_id);

    if !enabled || read_bool(storage, &collection_field_key(collection_id, FIELD_PAUSED)) {
        return false;
    }

    if !checkin_window_open(enabled, start_at, end_at) {
        return false;
    }

    if membership_required && load_membership_balance(storage, collection_id, account_id) <= 0 {
        return false;
    }

    let (checkin_count, last_checkin_at) = get_checkin_wallet_stats(storage, collection_id, account_id);

    if max_per_wallet > 0 && checkin_count >= max_per_wallet {
        return false;
    }

    if interval_seconds > 0 && last_checkin_at > 0 {
        let Some(next_available_at) = last_checkin_at.checked_add(interval_seconds) else {
            return false;
        };

        if now() < next_available_at {
            return false;
        }
    }

    true
}

#[neo_contract]
impl MultiTenantNftPlatformRust {
    #[neo_method(
        name = "configureCheckInProgram",
        param_types = [
            "Hash160",
            "ByteArray",
            "Boolean",
            "Boolean",
            "Boolean",
            "Integer",
            "Integer",
            "Integer",
            "Integer",
            "Boolean"
        ]
    )]
    pub fn configure_check_in_program(
        creator: i64,
        collection_id: i64,
        enabled: bool,
        membership_required: bool,
        membership_soulbound: bool,
        start_at: i64,
        end_at: i64,
        interval_seconds: i64,
        max_checkins_per_wallet: i64,
        mint_proof_nft: bool,
    ) -> bool {
        if creator <= 0
            || collection_id <= 0
            || start_at < 0
            || end_at < 0
            || interval_seconds < 0
            || max_checkins_per_wallet < 0
        {
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

        if !set_checkin_program(
            &storage,
            collection_id,
            enabled,
            membership_required,
            membership_soulbound,
            start_at,
            end_at,
            interval_seconds,
            max_checkins_per_wallet,
            mint_proof_nft,
        ) {
            return false;
        }

        emit_checkin_program_updated(
            collection_id,
            enabled,
            membership_required,
            membership_soulbound,
            start_at,
            end_at,
            interval_seconds,
            max_checkins_per_wallet,
            mint_proof_nft,
        );

        true
    }

    #[neo_method(
        name = "checkIn",
        param_types = ["Hash160", "ByteArray", "Integer", "Integer"],
        return_type = "Array"
    )]
    pub fn check_in(claimer: i64, collection_id: i64, token_uri_ref: i64, properties_ref: i64) -> i64 {
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

        let (enabled, membership_required, _, start_at, end_at, interval_seconds, max_per_wallet, mint_proof_nft) =
            get_checkin_program(&storage, collection_id);

        if !enabled || !checkin_window_open(enabled, start_at, end_at) {
            return 0;
        }

        if read_bool(&storage, &collection_field_key(collection_id, FIELD_PAUSED)) {
            return 0;
        }

        if membership_required && load_membership_balance(&storage, collection_id, claimer_id) <= 0 {
            return 0;
        }

        let (checkin_count, last_checkin_at) = get_checkin_wallet_stats(&storage, collection_id, claimer_id);

        if max_per_wallet > 0 && checkin_count >= max_per_wallet {
            return 0;
        }

        if interval_seconds > 0 && last_checkin_at > 0 {
            let Some(next_available_at) = last_checkin_at.checked_add(interval_seconds) else {
                return 0;
            };

            if now() < next_available_at {
                return 0;
            }
        }

        let proof_token_id = if mint_proof_nft {
            mint_token_for_account(
                &storage,
                collection_id,
                claimer_id,
                token_uri_ref,
                properties_ref,
                TOKEN_CLASS_CHECKIN_PROOF,
            )
        } else {
            0
        };

        if mint_proof_nft && proof_token_id <= 0 {
            return 0;
        }

        let next_count = checkin_count + 1;
        let checked_at = now();
        if !set_checkin_wallet_stats(&storage, collection_id, claimer_id, next_count, checked_at) {
            // Preserve check-in atomicity: stats update and optional proof mint must commit together.
            panic!("Failed to persist check-in wallet stats");
        }

        emit_checked_in(
            &storage,
            collection_id,
            claimer_id,
            next_count,
            checked_at,
            proof_token_id,
        );

        let mut result = NeoArray::new();
        if proof_token_id > 0 {
            result.push(token_id_value(proof_token_id));
        } else {
            result.push(NeoValue::ByteString(NeoByteString::from_slice(&[])));
        }
        result.push(NeoValue::Integer(NeoInteger::new(next_count)));
        result.push(NeoValue::Integer(NeoInteger::new(checked_at)));
        to_iterator_handle(result)
    }

    #[neo_method(name = "getCheckInProgram", safe, param_types = ["ByteArray"], return_type = "Array")]
    pub fn get_check_in_program(collection_id: i64) -> i64 {
        if collection_id <= 0 {
            return 0;
        }

        let Some(storage) = storage_context() else {
            return 0;
        };

        if !collection_exists(&storage, collection_id) {
            return 0;
        }

        let (enabled, membership_required, membership_soulbound, start_at, end_at, interval_seconds, max_per_wallet, mint_proof_nft) =
            get_checkin_program(&storage, collection_id);

        let mut result = NeoArray::new();
        result.push(NeoValue::Boolean(NeoBoolean::new(enabled)));
        result.push(NeoValue::Boolean(NeoBoolean::new(membership_required)));
        result.push(NeoValue::Boolean(NeoBoolean::new(membership_soulbound)));
        result.push(NeoValue::Integer(NeoInteger::new(start_at)));
        result.push(NeoValue::Integer(NeoInteger::new(end_at)));
        result.push(NeoValue::Integer(NeoInteger::new(interval_seconds)));
        result.push(NeoValue::Integer(NeoInteger::new(max_per_wallet)));
        result.push(NeoValue::Boolean(NeoBoolean::new(mint_proof_nft)));
        to_iterator_handle(result)
    }

    #[neo_method(
        name = "getCheckInWalletStats",
        safe,
        param_types = ["ByteArray", "Hash160"],
        return_type = "Array"
    )]
    pub fn get_check_in_wallet_stats(collection_id: i64, account: i64) -> i64 {
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

        let (_, _, _, _, _, _, max_per_wallet, _) = get_checkin_program(&storage, collection_id);
        let (checkin_count, last_checkin_at) = get_checkin_wallet_stats(&storage, collection_id, account_id);
        let remaining = if max_per_wallet <= 0 {
            i64::MAX
        } else if checkin_count >= max_per_wallet {
            0
        } else {
            max_per_wallet - checkin_count
        };
        let check_in_now = can_checkin_now(&storage, collection_id, account_id);

        let mut result = NeoArray::new();
        result.push(NeoValue::Integer(NeoInteger::new(checkin_count)));
        result.push(NeoValue::Integer(NeoInteger::new(last_checkin_at)));
        result.push(NeoValue::Integer(NeoInteger::new(remaining)));
        result.push(NeoValue::Boolean(NeoBoolean::new(check_in_now)));
        to_iterator_handle(result)
    }

    #[neo_method(name = "canCheckIn", safe, param_types = ["ByteArray", "Hash160"])]
    pub fn can_check_in(collection_id: i64, account: i64) -> bool {
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

        can_checkin_now(&storage, collection_id, account_id)
    }

    #[neo_method(
        name = "getMembershipStatus",
        safe,
        param_types = ["ByteArray", "Hash160"],
        return_type = "Array"
    )]
    pub fn get_membership_status(collection_id: i64, account: i64) -> i64 {
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

        let (_, membership_required, membership_soulbound, _, _, _, _, _) = get_checkin_program(&storage, collection_id);
        let balance = load_membership_balance(&storage, collection_id, account_id);

        let mut result = NeoArray::new();
        result.push(NeoValue::Integer(NeoInteger::new(balance)));
        result.push(NeoValue::Boolean(NeoBoolean::new(balance > 0)));
        result.push(NeoValue::Boolean(NeoBoolean::new(membership_required)));
        result.push(NeoValue::Boolean(NeoBoolean::new(membership_soulbound)));
        to_iterator_handle(result)
    }

    #[neo_method(name = "getTokenClass", safe, param_types = ["ByteArray"])]
    pub fn get_token_class(token_id: i64) -> i64 {
        if token_id <= 0 {
            return 0;
        }

        let Some(storage) = storage_context() else {
            return 0;
        };

        if !token_exists(&storage, token_id) {
            return 0;
        }

        read_i64(&storage, &token_field_key(token_id, TOKEN_FIELD_CLASS))
    }
}
