-- 1. Create sync_state table
CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 2. Create collections table
CREATE TABLE IF NOT EXISTS collections (
  collection_id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  description TEXT NOT NULL,
  base_uri TEXT NOT NULL,
  contract_hash TEXT,
  max_supply TEXT NOT NULL,
  minted TEXT NOT NULL,
  royalty_bps INTEGER NOT NULL,
  transferable INTEGER NOT NULL,
  paused INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

-- 3. Create tokens table
CREATE TABLE IF NOT EXISTS tokens (
  token_id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections(collection_id),
  owner TEXT NOT NULL,
  uri TEXT NOT NULL,
  properties_json TEXT NOT NULL,
  burned INTEGER NOT NULL,
  minted_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

-- 4. Create transfers table
CREATE TABLE IF NOT EXISTS transfers (
  id BIGSERIAL PRIMARY KEY,
  txid TEXT NOT NULL,
  token_id TEXT NOT NULL,
  from_address TEXT,
  to_address TEXT,
  block_index INTEGER NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL
);

-- 5. Create token_listings table
CREATE TABLE IF NOT EXISTS token_listings (
  token_id TEXT PRIMARY KEY REFERENCES tokens(token_id),
  seller TEXT NOT NULL,
  price TEXT NOT NULL,
  listed INTEGER NOT NULL,
  listed_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

-- 6. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_collections_owner ON collections(owner);
CREATE INDEX IF NOT EXISTS idx_tokens_owner ON tokens(owner);
CREATE INDEX IF NOT EXISTS idx_tokens_collection ON tokens(collection_id);
CREATE INDEX IF NOT EXISTS idx_transfers_token ON transfers(token_id);
CREATE INDEX IF NOT EXISTS idx_transfers_block ON transfers(block_index);
CREATE INDEX IF NOT EXISTS idx_token_listings_listed ON token_listings(listed);
CREATE INDEX IF NOT EXISTS idx_token_listings_updated ON token_listings(updated_at);

-- 7. Enable Realtime (Optional but recommended)
-- alter publication supabase_realtime add table tokens;
-- alter publication supabase_realtime add table token_listings;
-- alter publication supabase_realtime add table transfers;
