pub fn collection_field_key(collection_id: i64, field: u8) -> Vec<u8> {
    let mut key = b"mnr:c:".to_vec();
    key.extend_from_slice(&collection_id.to_le_bytes());
    key.push(field);
    key
}

pub fn collection_serial_key(collection_id: i64) -> Vec<u8> {
    let mut key = b"mnr:c:serial:".to_vec();
    key.extend_from_slice(&collection_id.to_le_bytes());
    key
}

pub fn collection_token_key(collection_id: i64, serial: i64) -> Vec<u8> {
    let mut key = b"mnr:c:token:".to_vec();
    key.extend_from_slice(&collection_id.to_le_bytes());
    key.push(b':');
    key.extend_from_slice(&serial.to_le_bytes());
    key
}

pub fn token_field_key(token_id: i64, field: u8) -> Vec<u8> {
    let mut key = b"mnr:t:".to_vec();
    key.extend_from_slice(&token_id.to_le_bytes());
    key.push(field);
    key
}

pub fn global_token_key(index: i64) -> Vec<u8> {
    let mut key = b"mnr:g:token:".to_vec();
    key.extend_from_slice(&index.to_le_bytes());
    key
}

pub fn balance_key(owner: i64) -> Vec<u8> {
    let mut key = b"mnr:balance:".to_vec();
    key.extend_from_slice(&owner.to_le_bytes());
    key
}

pub fn operator_key(collection_id: i64, operator: i64) -> Vec<u8> {
    let mut key = b"mnr:operator:".to_vec();
    key.extend_from_slice(&collection_id.to_le_bytes());
    key.push(b':');
    key.extend_from_slice(&operator.to_le_bytes());
    key
}

pub fn account_hash_key(account_id: i64) -> Vec<u8> {
    let mut key = b"mnr:account:".to_vec();
    key.extend_from_slice(&account_id.to_le_bytes());
    key
}

pub fn owner_collection_key(owner: i64) -> Vec<u8> {
    let mut key = b"mnr:owner:collection:".to_vec();
    key.extend_from_slice(&owner.to_le_bytes());
    key
}

pub fn drop_config_key(collection_id: i64, field: u8) -> Vec<u8> {
    let mut key = b"mnr:drop:cfg:".to_vec();
    key.extend_from_slice(&collection_id.to_le_bytes());
    key.push(field);
    key
}

pub fn drop_whitelist_key(collection_id: i64, account: i64) -> Vec<u8> {
    let mut key = b"mnr:drop:wl:".to_vec();
    key.extend_from_slice(&collection_id.to_le_bytes());
    key.push(b':');
    key.extend_from_slice(&account.to_le_bytes());
    key
}

pub fn drop_claimed_key(collection_id: i64, account: i64) -> Vec<u8> {
    let mut key = b"mnr:drop:claimed:".to_vec();
    key.extend_from_slice(&collection_id.to_le_bytes());
    key.push(b':');
    key.extend_from_slice(&account.to_le_bytes());
    key
}

pub fn checkin_program_key(collection_id: i64, field: u8) -> Vec<u8> {
    let mut key = b"mnr:checkin:cfg:".to_vec();
    key.extend_from_slice(&collection_id.to_le_bytes());
    key.push(field);
    key
}

pub fn checkin_wallet_key(collection_id: i64, account: i64, field: u8) -> Vec<u8> {
    let mut key = b"mnr:checkin:wallet:".to_vec();
    key.extend_from_slice(&collection_id.to_le_bytes());
    key.push(b':');
    key.extend_from_slice(&account.to_le_bytes());
    key.push(field);
    key
}

pub fn membership_balance_key(collection_id: i64, account: i64) -> Vec<u8> {
    let mut key = b"mnr:membership:balance:".to_vec();
    key.extend_from_slice(&collection_id.to_le_bytes());
    key.push(b':');
    key.extend_from_slice(&account.to_le_bytes());
    key
}
