export type UInt160Hex = string;
export type ByteStringHex = string;
export type ContractDialect = "csharp" | "solidity" | "rust";

export interface CollectionCreateRequest {
  name: string;
  symbol: string;
  description: string;
  baseUri: string;
  maxSupply: string;
  royaltyBps: number;
  transferable: boolean;
  creatorRef?: string;
  nameRef?: string;
  symbolRef?: string;
  descriptionRef?: string;
  baseUriRef?: string;
}

export interface CollectionCreateAndDeployRequest extends CollectionCreateRequest {
  extraData?: string | number | boolean | null | Array<unknown> | Record<string, unknown>;
}

export interface CollectionUpdateRequest {
  collectionId: ByteStringHex;
  description?: string;
  baseUri?: string;
  royaltyBps?: number;
  transferable?: boolean;
  paused?: boolean;
  creatorRef?: string;
  descriptionRef?: string;
  baseUriRef?: string;
}

export interface SetCollectionOperatorRequest {
  collectionId: ByteStringHex;
  operator: string;
  enabled: boolean;
  creatorRef?: string;
  operatorRef?: string;
}

export interface MintRequest {
  collectionId: ByteStringHex;
  to: string;
  tokenUri: string;
  propertiesJson: string;
  operatorRef?: string;
  toRef?: string;
  tokenUriRef?: string;
  propertiesRef?: string;
}

export interface BatchMintRequest extends MintRequest {
  amount: number | string;
}

export interface BurnRequest {
  tokenId: ByteStringHex;
  operatorRef?: string;
}

export interface TransferRequest {
  to: string;
  tokenId: ByteStringHex;
  toRef?: string;
  dataRef?: string;
}

export interface SetCollectionContractTemplateRequest {
  nefFileHex: string;
  manifest: string;
}

export interface SetCollectionContractTemplateNameSegmentsRequest {
  manifestPrefix: string;
  templateNameBase: string;
  manifestSuffix: string;
}

export interface DeployCollectionContractFromTemplateRequest {
  collectionId: ByteStringHex;
  extraData?: string | number | boolean | null | Array<unknown> | Record<string, unknown>;
}

export interface ConfigureDropRequest {
  collectionId: ByteStringHex;
  enabled: boolean;
  startAt?: number | string;
  endAt?: number | string;
  perWalletLimit?: number | string;
  whitelistRequired?: boolean;
  creatorRef?: string;
}

export interface ConfigureCheckInProgramRequest {
  collectionId: ByteStringHex;
  enabled: boolean;
  membershipRequired?: boolean;
  membershipSoulbound?: boolean;
  startAt?: number | string;
  endAt?: number | string;
  intervalSeconds?: number | string;
  maxCheckInsPerWallet?: number | string;
  mintProofNft?: boolean;
  creatorRef?: string;
}

export interface SetDropWhitelistRequest {
  collectionId: ByteStringHex;
  account: string;
  allowance: number | string;
  creatorRef?: string;
  accountRef?: string;
}

export interface SetDropWhitelistBatchEntry {
  account: string;
  allowance: number | string;
  accountRef?: string;
}

export interface SetDropWhitelistBatchRequest {
  collectionId: ByteStringHex;
  entries: SetDropWhitelistBatchEntry[];
  creatorRef?: string;
}

export interface ClaimDropRequest {
  collectionId: ByteStringHex;
  tokenUri?: string;
  propertiesJson?: string;
  claimerRef?: string;
  tokenUriRef?: string;
  propertiesRef?: string;
}

export interface CheckInRequest {
  collectionId: ByteStringHex;
  tokenUri?: string;
  propertiesJson?: string;
  claimerRef?: string;
  tokenUriRef?: string;
  propertiesRef?: string;
}

export interface CollectionView {
  id: ByteStringHex;
  owner: string;
  name: string;
  symbol: string;
  description: string;
  baseUri: string;
  maxSupply: string;
  minted: string;
  royaltyBps: number;
  transferable: boolean;
  paused: boolean;
  createdAt: string;
}

export interface TokenView {
  tokenId: ByteStringHex;
  collectionId: ByteStringHex;
  owner: string;
  uri: string;
  propertiesJson: string;
  burned: boolean;
  mintedAt: string;
}

export interface ContractArgument {
  type: string;
  value: string | number | boolean | null | Array<unknown> | Record<string, unknown>;
}

export interface WalletInvokeRequest {
  scriptHash: string;
  operation: string;
  args: ContractArgument[];
  fee?: string;
  networkFee?: string;
}

export interface RpcConfig {
  rpcUrl: string;
  contractHash: string;
  dialect?: ContractDialect;
}
