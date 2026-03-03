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

export interface TokenListingRecord {
  tokenId: string;
  seller: string;
  price: string;
  listed: number;
  listedAt: string;
  updatedAt: string;
}

export interface MarketListingRecord {
  tokenId: string;
  collectionId: string;
  owner: string;
  uri: string;
  propertiesJson: string;
  burned: number;
  mintedAt: string;
  tokenUpdatedAt: string;
  collectionOwner: string;
  collectionName: string;
  collectionSymbol: string;
  collectionDescription: string;
  collectionBaseUri: string;
  collectionContractHash?: string | null;
  collectionMaxSupply: string;
  collectionMinted: string;
  collectionRoyaltyBps: number;
  collectionTransferable: number;
  collectionPaused: number;
  collectionCreatedAt: string;
  collectionUpdatedAt: string;
  listed: number;
  seller: string | null;
  price: string | null;
  listedAt: string | null;
  listingUpdatedAt: string | null;
}
