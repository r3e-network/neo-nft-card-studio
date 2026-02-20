use neo_devpack::prelude::*;

pub fn storage_context() -> Option<NeoStorageContext> {
    NeoStorage::get_context().ok()
}

pub fn read_i64(storage: &NeoStorageContext, key: &[u8]) -> i64 {
    let key_bs = NeoByteString::from_slice(key);
    let value_bs = match NeoStorage::get(storage, &key_bs) {
        Ok(value) => value,
        Err(_) => return 0,
    };

    let bytes = value_bs.as_slice();
    if bytes.len() < 8 {
        return 0;
    }

    let mut arr = [0u8; 8];
    arr.copy_from_slice(&bytes[..8]);
    i64::from_le_bytes(arr)
}

pub fn write_i64(storage: &NeoStorageContext, key: &[u8], value: i64) -> bool {
    let key_bs = NeoByteString::from_slice(key);
    let value_bs = NeoByteString::from_slice(&value.to_le_bytes());
    NeoStorage::put(storage, &key_bs, &value_bs).is_ok()
}

pub fn read_bool(storage: &NeoStorageContext, key: &[u8]) -> bool {
    read_i64(storage, key) != 0
}

pub fn write_bool(storage: &NeoStorageContext, key: &[u8], value: bool) -> bool {
    write_i64(storage, key, if value { 1 } else { 0 })
}

pub fn read_bytes(storage: &NeoStorageContext, key: &[u8]) -> Option<NeoByteString> {
    let key_bs = NeoByteString::from_slice(key);
    NeoStorage::get(storage, &key_bs).ok()
}

pub fn write_bytes(storage: &NeoStorageContext, key: &[u8], value: &NeoByteString) -> bool {
    let key_bs = NeoByteString::from_slice(key);
    NeoStorage::put(storage, &key_bs, value).is_ok()
}

pub fn now() -> i64 {
    NeoRuntime::get_time()
        .map(|v| v.as_i64_saturating())
        .unwrap_or(0)
}
