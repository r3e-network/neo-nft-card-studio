pub const KEY_TOTAL_SUPPLY: &[u8] = b"mnr:total";
pub const KEY_COLLECTION_COUNTER: &[u8] = b"mnr:collection:counter";
pub const KEY_GLOBAL_TOKEN_COUNTER: &[u8] = b"mnr:token:global_counter";
pub const TOKEN_SERIAL_FACTOR: i64 = 1_000_000;

pub const FIELD_OWNER: u8 = 0x01;
pub const FIELD_NAME_REF: u8 = 0x02;
pub const FIELD_SYMBOL_REF: u8 = 0x03;
pub const FIELD_DESC_REF: u8 = 0x04;
pub const FIELD_BASE_URI_REF: u8 = 0x05;
pub const FIELD_MAX_SUPPLY: u8 = 0x06;
pub const FIELD_MINTED: u8 = 0x07;
pub const FIELD_ROYALTY_BPS: u8 = 0x08;
pub const FIELD_TRANSFERABLE: u8 = 0x09;
pub const FIELD_PAUSED: u8 = 0x0A;
pub const FIELD_CREATED_AT: u8 = 0x0B;

pub const TOKEN_FIELD_COLLECTION_ID: u8 = 0x11;
pub const TOKEN_FIELD_OWNER: u8 = 0x12;
pub const TOKEN_FIELD_URI_REF: u8 = 0x13;
pub const TOKEN_FIELD_PROPERTIES_REF: u8 = 0x14;
pub const TOKEN_FIELD_BURNED: u8 = 0x15;
pub const TOKEN_FIELD_MINTED_AT: u8 = 0x16;
pub const TOKEN_FIELD_CLASS: u8 = 0x17;

pub const TOKEN_CLASS_STANDARD: i64 = 0;
pub const TOKEN_CLASS_MEMBERSHIP: i64 = 1;
pub const TOKEN_CLASS_CHECKIN_PROOF: i64 = 2;

pub const DROP_FIELD_ENABLED: u8 = 0x21;
pub const DROP_FIELD_START_AT: u8 = 0x22;
pub const DROP_FIELD_END_AT: u8 = 0x23;
pub const DROP_FIELD_PER_WALLET_LIMIT: u8 = 0x24;
pub const DROP_FIELD_WHITELIST_REQUIRED: u8 = 0x25;

pub const CHECKIN_FIELD_ENABLED: u8 = 0x31;
pub const CHECKIN_FIELD_MEMBERSHIP_REQUIRED: u8 = 0x32;
pub const CHECKIN_FIELD_MEMBERSHIP_SOULBOUND: u8 = 0x33;
pub const CHECKIN_FIELD_START_AT: u8 = 0x34;
pub const CHECKIN_FIELD_END_AT: u8 = 0x35;
pub const CHECKIN_FIELD_INTERVAL_SECONDS: u8 = 0x36;
pub const CHECKIN_FIELD_MAX_PER_WALLET: u8 = 0x37;
pub const CHECKIN_FIELD_MINT_PROOF_NFT: u8 = 0x38;

pub const CHECKIN_WALLET_FIELD_COUNT: u8 = 0x41;
pub const CHECKIN_WALLET_FIELD_LAST_AT: u8 = 0x42;
