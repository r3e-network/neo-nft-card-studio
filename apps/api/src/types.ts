export interface CollectionRecord {
  collectionId: string;
  owner: string;
  name: string;
  symbol: string;
  description: string;
  baseUri: string;
  contractHash?: string | null;
  maxSupply: string;
  minted: string;
  royaltyBps: number;
  transferable: number;
  paused: number;
  createdAt: string;
  updatedAt: string;
}

export interface TokenRecord {
  tokenId: string;
  collectionId: string;
  owner: string;
  uri: string;
  propertiesJson: string;
  burned: number;
  mintedAt: string;
  updatedAt: string;
}

export interface TransferRecord {
  txid: string;
  tokenId: string;
  fromAddress: string | null;
  toAddress: string | null;
  blockIndex: number;
  timestamp: string;
}
