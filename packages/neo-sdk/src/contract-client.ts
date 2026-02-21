import type {
  BurnRequest,
  CollectionCreateAndDeployRequest,
  CollectionCreateRequest,
  CheckInRequest,
  ClaimDropRequest,
  ConfigureCheckInProgramRequest,
  ConfigureDropRequest,
  DeployCollectionContractFromTemplateRequest,
  CollectionUpdateRequest,
  ContractDialect,
  ContractArgument,
  MintRequest,
  BatchMintRequest,
  RpcConfig,
  SetDropWhitelistBatchRequest,
  SetDropWhitelistRequest,
  SetCollectionContractTemplateRequest,
  SetCollectionContractTemplateNameSegmentsRequest,
  SetCollectionOperatorRequest,
  TransferRequest,
  WalletInvokeRequest,
} from "./types";
import { NeoRpcService } from "./rpc";

const HEX_CHARS = /^[0-9a-fA-F]+$/;

function utf8ToHex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function stripHexPrefix(value: string): string {
  return value.startsWith("0x") || value.startsWith("0X") ? value.slice(2) : value;
}

function isHexEncodedByteArray(value: string): boolean {
  const trimmed = value.trim();
  const normalized = stripHexPrefix(trimmed);
  if (normalized.length === 0 || normalized.length % 2 !== 0 || !HEX_CHARS.test(normalized)) {
    return false;
  }

  if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) {
    return true;
  }

  // Backward-compatible path: unprefixed 32-byte hashes.
  return normalized.length >= 64;
}

function toByteArrayArg(hexOrText: string): ContractArgument {
  const normalized = isHexEncodedByteArray(hexOrText) ? stripHexPrefix(hexOrText.trim()) : utf8ToHex(hexOrText);
  return {
    type: "ByteArray",
    value: normalized,
  };
}

function byteArrayHexArg(hexValue: string): ContractArgument {
  const normalized = stripHexPrefix(hexValue.trim());
  if (normalized.length === 0 || normalized.length % 2 !== 0 || !HEX_CHARS.test(normalized)) {
    throw new Error("Invalid hex byte array");
  }

  return {
    type: "ByteArray",
    value: normalized,
  };
}

function toIntegerLike(value: string | number, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.trunc(parsed);
}

function normalizeExtraDataArg(
  value: string | number | boolean | null | Array<unknown> | Record<string, unknown> | undefined,
): string | number | boolean | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  return JSON.stringify(value);
}

export function stringArg(value: string): ContractArgument {
  return {
    type: "String",
    value,
  };
}

export function integerArg(value: number | string): ContractArgument {
  return {
    type: "Integer",
    value: value.toString(),
  };
}

export function hash160Arg(value: string): ContractArgument {
  return {
    type: "Hash160",
    value,
  };
}

export function hash256Arg(value: string): ContractArgument {
  return {
    type: "Hash256",
    value,
  };
}

export function boolArg(value: boolean): ContractArgument {
  return {
    type: "Boolean",
    value,
  };
}

export function arrayArg(value: ContractArgument[]): ContractArgument {
  return {
    type: "Array",
    value,
  };
}

export class NeoNftPlatformClient {
  private readonly rpc: NeoRpcService;
  private readonly dialect: ContractDialect;

  constructor(private readonly config: RpcConfig) {
    this.rpc = new NeoRpcService(config);
    this.dialect = config.dialect ?? "csharp";
  }

  getConfig(): RpcConfig {
    return this.config;
  }

  getDialect(): ContractDialect {
    return this.dialect;
  }

  forContract(contractHash: string): NeoNftPlatformClient {
    return new NeoNftPlatformClient({
      ...this.config,
      contractHash,
      dialect: this.dialect,
    });
  }

  async symbol(): Promise<string> {
    const [value] = await this.rpc.invokeRead("symbol");
    return value?.toString() ?? "";
  }

  async decimals(): Promise<number> {
    const [value] = await this.rpc.invokeRead("decimals");
    return Number(value ?? 0);
  }

  async totalSupply(): Promise<string> {
    const [value] = await this.rpc.invokeRead("totalSupply");
    return value?.toString() ?? "0";
  }

  async balanceOf(owner: string): Promise<string> {
    const [value] =
      this.dialect === "rust"
        ? await this.rpc.invokeRead("balanceOf", [integerArg(toIntegerLike(owner, 0))])
        : await this.rpc.invokeRead("balanceOf", [hash160Arg(owner)]);
    return value?.toString() ?? "0";
  }

  async ownerOf(tokenIdHex: string): Promise<string> {
    const [value] =
      this.dialect === "rust"
        ? await this.rpc.invokeRead("ownerOf", [integerArg(toIntegerLike(tokenIdHex, 0))])
        : this.dialect === "solidity"
          ? await this.rpc.invokeRead("ownerOf", [hash256Arg(tokenIdHex)])
          : await this.rpc.invokeRead("ownerOf", [toByteArrayArg(tokenIdHex)]);
    return value?.toString() ?? "";
  }

  async getCollection(collectionIdHex: string): Promise<unknown> {
    const [value] =
      this.dialect === "rust"
        ? await this.rpc.invokeRead("getCollection", [integerArg(toIntegerLike(collectionIdHex, 0))])
        : this.dialect === "solidity"
          ? await this.rpc.invokeRead("getCollection", [integerArg(collectionIdHex)])
          : await this.rpc.invokeRead("getCollection", [toByteArrayArg(collectionIdHex)]);
    return value;
  }

  async getToken(tokenIdHex: string): Promise<unknown> {
    const [value] =
      this.dialect === "rust"
        ? await this.rpc.invokeRead("getToken", [integerArg(toIntegerLike(tokenIdHex, 0))])
        : this.dialect === "solidity"
          ? await this.rpc.invokeRead("getToken", [hash256Arg(tokenIdHex)])
          : await this.rpc.invokeRead("getToken", [toByteArrayArg(tokenIdHex)]);
    return value;
  }

  async getDropConfig(collectionIdHex: string): Promise<unknown> {
    const [value] =
      this.dialect === "rust"
        ? await this.rpc.invokeRead("getDropConfig", [integerArg(toIntegerLike(collectionIdHex, 0))])
        : this.dialect === "solidity"
          ? await this.rpc.invokeRead("getDropConfig", [integerArg(collectionIdHex)])
          : await this.rpc.invokeRead("getDropConfig", [toByteArrayArg(collectionIdHex)]);
    return value;
  }

  async getDropWalletStats(collectionIdHex: string, account: string): Promise<unknown> {
    const [value] =
      this.dialect === "rust"
        ? await this.rpc.invokeRead("getDropWalletStats", [
          integerArg(toIntegerLike(collectionIdHex, 0)),
          integerArg(toIntegerLike(account, 0)),
        ])
        : this.dialect === "solidity"
          ? await this.rpc.invokeRead("getDropWalletStats", [integerArg(collectionIdHex), hash160Arg(account)])
          : await this.rpc.invokeRead("getDropWalletStats", [toByteArrayArg(collectionIdHex), hash160Arg(account)]);
    return value;
  }

  async canClaimDrop(collectionIdHex: string, account: string): Promise<boolean> {
    const [value] =
      this.dialect === "rust"
        ? await this.rpc.invokeRead("canClaimDrop", [
          integerArg(toIntegerLike(collectionIdHex, 0)),
          integerArg(toIntegerLike(account, 0)),
        ])
        : this.dialect === "solidity"
          ? await this.rpc.invokeRead("canClaimDrop", [integerArg(collectionIdHex), hash160Arg(account)])
          : await this.rpc.invokeRead("canClaimDrop", [toByteArrayArg(collectionIdHex), hash160Arg(account)]);
    return value === true;
  }

  async getCheckInProgram(collectionIdHex: string): Promise<unknown> {
    const [value] =
      this.dialect === "rust"
        ? await this.rpc.invokeRead("getCheckInProgram", [integerArg(toIntegerLike(collectionIdHex, 0))])
        : this.dialect === "solidity"
          ? await this.rpc.invokeRead("getCheckInProgram", [integerArg(collectionIdHex)])
          : await this.rpc.invokeRead("getCheckInProgram", [toByteArrayArg(collectionIdHex)]);
    return value;
  }

  async getCheckInWalletStats(collectionIdHex: string, account: string): Promise<unknown> {
    const [value] =
      this.dialect === "rust"
        ? await this.rpc.invokeRead("getCheckInWalletStats", [
          integerArg(toIntegerLike(collectionIdHex, 0)),
          integerArg(toIntegerLike(account, 0)),
        ])
        : this.dialect === "solidity"
          ? await this.rpc.invokeRead("getCheckInWalletStats", [integerArg(collectionIdHex), hash160Arg(account)])
          : await this.rpc.invokeRead("getCheckInWalletStats", [toByteArrayArg(collectionIdHex), hash160Arg(account)]);
    return value;
  }

  async canCheckIn(collectionIdHex: string, account: string): Promise<boolean> {
    const [value] =
      this.dialect === "rust"
        ? await this.rpc.invokeRead("canCheckIn", [
          integerArg(toIntegerLike(collectionIdHex, 0)),
          integerArg(toIntegerLike(account, 0)),
        ])
        : this.dialect === "solidity"
          ? await this.rpc.invokeRead("canCheckIn", [integerArg(collectionIdHex), hash160Arg(account)])
          : await this.rpc.invokeRead("canCheckIn", [toByteArrayArg(collectionIdHex), hash160Arg(account)]);
    return value === true;
  }

  async getMembershipStatus(collectionIdHex: string, account: string): Promise<unknown> {
    const [value] =
      this.dialect === "rust"
        ? await this.rpc.invokeRead("getMembershipStatus", [
          integerArg(toIntegerLike(collectionIdHex, 0)),
          integerArg(toIntegerLike(account, 0)),
        ])
        : this.dialect === "solidity"
          ? await this.rpc.invokeRead("getMembershipStatus", [integerArg(collectionIdHex), hash160Arg(account)])
          : await this.rpc.invokeRead("getMembershipStatus", [toByteArrayArg(collectionIdHex), hash160Arg(account)]);
    return value;
  }

  async getTokenClass(tokenIdHex: string): Promise<string> {
    const [value] =
      this.dialect === "rust"
        ? await this.rpc.invokeRead("getTokenClass", [integerArg(toIntegerLike(tokenIdHex, 0))])
        : this.dialect === "solidity"
          ? await this.rpc.invokeRead("getTokenClass", [hash256Arg(tokenIdHex)])
          : await this.rpc.invokeRead("getTokenClass", [toByteArrayArg(tokenIdHex)]);

    return value?.toString() ?? "0";
  }

  async getRoyalties(tokenIdHex: string): Promise<string> {
    const [value] =
      this.dialect === "rust"
        ? await this.rpc.invokeRead("getRoyalties", [integerArg(toIntegerLike(tokenIdHex, 0))])
        : this.dialect === "solidity"
          ? await this.rpc.invokeRead("getRoyalties", [hash256Arg(tokenIdHex)])
          : await this.rpc.invokeRead("getRoyalties", [toByteArrayArg(tokenIdHex)]);

    return value?.toString() ?? "";
  }

  async getCollectionContract(collectionId: string): Promise<string> {
    if (this.dialect !== "csharp") {
      throw new Error("getCollectionContract is only available for csharp dialect");
    }

    const [value] = await this.rpc.invokeRead("getCollectionContract", [toByteArrayArg(collectionId)]);
    return value?.toString() ?? "";
  }

  async getOwnerDedicatedCollection(owner: string): Promise<string> {
    if (this.dialect !== "csharp") {
      throw new Error("getOwnerDedicatedCollection is only available for csharp dialect");
    }

    const [value] = await this.rpc.invokeRead("getOwnerDedicatedCollection", [hash160Arg(owner)]);
    return value?.toString() ?? "";
  }

  async getOwnerDedicatedCollectionContract(owner: string): Promise<string> {
    if (this.dialect !== "csharp") {
      throw new Error("getOwnerDedicatedCollectionContract is only available for csharp dialect");
    }

    const [value] = await this.rpc.invokeRead("getOwnerDedicatedCollectionContract", [hash160Arg(owner)]);
    return value?.toString() ?? "";
  }

  async hasOwnerDedicatedCollectionContract(owner: string): Promise<boolean> {
    if (this.dialect !== "csharp") {
      throw new Error("hasOwnerDedicatedCollectionContract is only available for csharp dialect");
    }

    const [value] = await this.rpc.invokeRead("hasOwnerDedicatedCollectionContract", [hash160Arg(owner)]);
    return value === true;
  }

  async hasCollectionContract(collectionId: string): Promise<boolean> {
    if (this.dialect !== "csharp") {
      throw new Error("hasCollectionContract is only available for csharp dialect");
    }

    const [value] = await this.rpc.invokeRead("hasCollectionContract", [toByteArrayArg(collectionId)]);
    return value === true;
  }

  async hasCollectionContractTemplate(): Promise<boolean> {
    if (this.dialect !== "csharp") {
      throw new Error("hasCollectionContractTemplate is only available for csharp dialect");
    }

    const [value] = await this.rpc.invokeRead("hasCollectionContractTemplate");
    return value === true;
  }

  async getCollectionContractTemplateDigest(): Promise<unknown> {
    if (this.dialect !== "csharp") {
      throw new Error("getCollectionContractTemplateDigest is only available for csharp dialect");
    }

    const [value] = await this.rpc.invokeRead("getCollectionContractTemplateDigest");
    return value;
  }

  async royaltyInfo(tokenIdHex: string, salePrice: string | number, royaltyToken?: string): Promise<unknown> {
    const [value] =
      this.dialect === "rust"
        ? await this.rpc.invokeRead("royaltyInfo", [
          integerArg(toIntegerLike(tokenIdHex, 0)),
          integerArg(toIntegerLike(royaltyToken ?? 0, 0)),
          integerArg(salePrice),
        ])
        : this.dialect === "solidity"
          ? await this.rpc.invokeRead("royaltyInfo", [
            hash256Arg(tokenIdHex),
            hash160Arg(royaltyToken ?? "0x0000000000000000000000000000000000000000"),
            integerArg(salePrice),
          ])
          : await this.rpc.invokeRead("royaltyInfo", [
            toByteArrayArg(tokenIdHex),
            hash160Arg(royaltyToken ?? "0x0000000000000000000000000000000000000000"),
            integerArg(salePrice),
          ]);

    return value;
  }

  buildCreateCollectionInvoke(payload: CollectionCreateRequest): WalletInvokeRequest {
    if (this.dialect === "rust") {
      return {
        scriptHash: this.config.contractHash,
        operation: "createCollection",
        args: [
          integerArg(toIntegerLike(payload.creatorRef ?? 1, 1)),
          integerArg(toIntegerLike(payload.nameRef ?? 0, 0)),
          integerArg(toIntegerLike(payload.symbolRef ?? 0, 0)),
          integerArg(toIntegerLike(payload.descriptionRef ?? 0, 0)),
          integerArg(toIntegerLike(payload.baseUriRef ?? 0, 0)),
          integerArg(payload.maxSupply),
          integerArg(payload.royaltyBps),
          boolArg(payload.transferable),
        ],
      };
    }

    return {
      scriptHash: this.config.contractHash,
      operation: "createCollection",
      args: [
        stringArg(payload.name),
        stringArg(payload.symbol),
        stringArg(payload.description),
        stringArg(payload.baseUri),
        integerArg(payload.maxSupply),
        integerArg(payload.royaltyBps),
        boolArg(payload.transferable),
      ],
    };
  }

  buildCreateCollectionAndDeployFromTemplateInvoke(payload: CollectionCreateAndDeployRequest): WalletInvokeRequest {
    if (this.dialect !== "csharp") {
      throw new Error("createCollectionAndDeployFromTemplate is only available for csharp dialect");
    }

    return {
      scriptHash: this.config.contractHash,
      operation: "createCollectionAndDeployFromTemplate",
      args: [
        stringArg(payload.name),
        stringArg(payload.symbol),
        stringArg(payload.description),
        stringArg(payload.baseUri),
        integerArg(payload.maxSupply),
        integerArg(payload.royaltyBps),
        boolArg(payload.transferable),
        { type: "Any", value: normalizeExtraDataArg(payload.extraData) },
      ],
    };
  }

  buildUpdateCollectionInvoke(payload: CollectionUpdateRequest): WalletInvokeRequest {
    if (this.dialect === "rust") {
      return {
        scriptHash: this.config.contractHash,
        operation: "updateCollection",
        args: [
          integerArg(toIntegerLike(payload.creatorRef ?? 1, 1)),
          integerArg(toIntegerLike(payload.collectionId, 0)),
          integerArg(toIntegerLike(payload.descriptionRef ?? payload.description ?? 0, 0)),
          integerArg(toIntegerLike(payload.baseUriRef ?? payload.baseUri ?? 0, 0)),
          integerArg(payload.royaltyBps ?? 0),
          boolArg(payload.transferable ?? true),
          boolArg(payload.paused ?? false),
        ],
      };
    }

    if (this.dialect === "solidity") {
      return {
        scriptHash: this.config.contractHash,
        operation: "updateCollection",
        args: [
          integerArg(payload.collectionId),
          stringArg(payload.description ?? ""),
          stringArg(payload.baseUri ?? ""),
          integerArg(payload.royaltyBps ?? 0),
          boolArg(payload.transferable ?? true),
          boolArg(payload.paused ?? false),
        ],
      };
    }

    return {
      scriptHash: this.config.contractHash,
      operation: "updateCollection",
      args: [
        toByteArrayArg(payload.collectionId),
        stringArg(payload.description ?? ""),
        stringArg(payload.baseUri ?? ""),
        integerArg(payload.royaltyBps ?? 0),
        boolArg(payload.transferable ?? true),
        boolArg(payload.paused ?? false),
      ],
    };
  }

  buildSetCollectionOperatorInvoke(payload: SetCollectionOperatorRequest): WalletInvokeRequest {
    if (this.dialect === "rust") {
      return {
        scriptHash: this.config.contractHash,
        operation: "setCollectionOperator",
        args: [
          integerArg(toIntegerLike(payload.creatorRef ?? 1, 1)),
          integerArg(toIntegerLike(payload.collectionId, 0)),
          integerArg(toIntegerLike(payload.operatorRef ?? payload.operator, 0)),
          boolArg(payload.enabled),
        ],
      };
    }

    if (this.dialect === "solidity") {
      return {
        scriptHash: this.config.contractHash,
        operation: "setCollectionOperator",
        args: [integerArg(payload.collectionId), hash160Arg(payload.operator), boolArg(payload.enabled)],
      };
    }

    return {
      scriptHash: this.config.contractHash,
      operation: "setCollectionOperator",
      args: [toByteArrayArg(payload.collectionId), hash160Arg(payload.operator), boolArg(payload.enabled)],
    };
  }

  buildMintInvoke(payload: MintRequest): WalletInvokeRequest {
    if (this.dialect === "rust") {
      return {
        scriptHash: this.config.contractHash,
        operation: "mint",
        args: [
          integerArg(toIntegerLike(payload.operatorRef ?? 1, 1)),
          integerArg(toIntegerLike(payload.collectionId, 0)),
          integerArg(toIntegerLike(payload.toRef ?? payload.to, 0)),
          integerArg(toIntegerLike(payload.tokenUriRef ?? payload.tokenUri, 0)),
          integerArg(toIntegerLike(payload.propertiesRef ?? payload.propertiesJson, 0)),
        ],
      };
    }

    if (this.dialect === "solidity") {
      return {
        scriptHash: this.config.contractHash,
        operation: "mint",
        args: [
          integerArg(payload.collectionId),
          hash160Arg(payload.to),
          stringArg(payload.tokenUri),
          toByteArrayArg(payload.propertiesJson),
        ],
      };
    }

    return {
      scriptHash: this.config.contractHash,
      operation: "mint",
      args: [
        toByteArrayArg(payload.collectionId),
        hash160Arg(payload.to),
        stringArg(payload.tokenUri),
        stringArg(payload.propertiesJson),
      ],
    };
  }

  buildBatchMintInvoke(payload: BatchMintRequest): WalletInvokeRequest {
    if (this.dialect === "rust") {
      throw new Error("Batch mint is not explicitly supported via standard SDK for Rust yet");
    }

    if (this.dialect === "solidity") {
      throw new Error("Batch mint is not supported for solidity dialect");
    }

    return {
      scriptHash: this.config.contractHash,
      operation: "batchMint",
      args: [
        toByteArrayArg(payload.collectionId),
        hash160Arg(payload.to),
        stringArg(payload.tokenUri),
        stringArg(payload.propertiesJson),
        integerArg(payload.amount),
      ],
    };
  }

  buildBurnInvoke(request: string | BurnRequest): WalletInvokeRequest {
    const payload: BurnRequest =
      typeof request === "string"
        ? {
          tokenId: request,
        }
        : request;

    if (this.dialect === "rust") {
      return {
        scriptHash: this.config.contractHash,
        operation: "burn",
        args: [integerArg(toIntegerLike(payload.operatorRef ?? 1, 1)), integerArg(toIntegerLike(payload.tokenId, 0))],
      };
    }

    if (this.dialect === "solidity") {
      return {
        scriptHash: this.config.contractHash,
        operation: "burn",
        args: [hash256Arg(payload.tokenId)],
      };
    }

    return {
      scriptHash: this.config.contractHash,
      operation: "burn",
      args: [toByteArrayArg(payload.tokenId)],
    };
  }

  buildTransferInvoke(toAddress: string, tokenIdHex: string, request?: Partial<TransferRequest>): WalletInvokeRequest {
    if (this.dialect === "rust") {
      return {
        scriptHash: this.config.contractHash,
        operation: "transfer",
        args: [
          integerArg(toIntegerLike(request?.toRef ?? toAddress, 0)),
          integerArg(toIntegerLike(tokenIdHex, 0)),
          integerArg(toIntegerLike(request?.dataRef ?? 0, 0)),
        ],
      };
    }

    if (this.dialect === "solidity") {
      return {
        scriptHash: this.config.contractHash,
        operation: "transfer",
        args: [hash160Arg(toAddress), hash256Arg(tokenIdHex), byteArrayHexArg(request?.dataRef ?? "0x00")],
      };
    }

    return {
      scriptHash: this.config.contractHash,
      operation: "transfer",
      args: [hash160Arg(toAddress), toByteArrayArg(tokenIdHex), { type: "Any", value: null }],
    };
  }

  buildSetCollectionContractTemplateInvoke(payload: SetCollectionContractTemplateRequest): WalletInvokeRequest {
    if (this.dialect !== "csharp") {
      throw new Error("setCollectionContractTemplate is only available for csharp dialect");
    }

    return {
      scriptHash: this.config.contractHash,
      operation: "setCollectionContractTemplate",
      args: [byteArrayHexArg(payload.nefFileHex), stringArg(payload.manifest)],
    };
  }

  buildSetCollectionContractTemplateNameSegmentsInvoke(
    payload: SetCollectionContractTemplateNameSegmentsRequest,
  ): WalletInvokeRequest {
    if (this.dialect !== "csharp") {
      throw new Error("setCollectionContractTemplateNameSegments is only available for csharp dialect");
    }

    return {
      scriptHash: this.config.contractHash,
      operation: "setCollectionContractTemplateNameSegments",
      args: [
        stringArg(payload.manifestPrefix),
        stringArg(payload.templateNameBase),
        stringArg(payload.manifestSuffix),
      ],
    };
  }

  buildClearCollectionContractTemplateInvoke(): WalletInvokeRequest {
    if (this.dialect !== "csharp") {
      throw new Error("clearCollectionContractTemplate is only available for csharp dialect");
    }

    return {
      scriptHash: this.config.contractHash,
      operation: "clearCollectionContractTemplate",
      args: [],
    };
  }

  buildDeployCollectionContractFromTemplateInvoke(
    payload: DeployCollectionContractFromTemplateRequest,
  ): WalletInvokeRequest {
    if (this.dialect !== "csharp") {
      throw new Error("deployCollectionContractFromTemplate is only available for csharp dialect");
    }

    return {
      scriptHash: this.config.contractHash,
      operation: "deployCollectionContractFromTemplate",
      args: [toByteArrayArg(payload.collectionId), { type: "Any", value: normalizeExtraDataArg(payload.extraData) }],
    };
  }

  buildConfigureDropInvoke(payload: ConfigureDropRequest): WalletInvokeRequest {
    if (this.dialect === "rust") {
      return {
        scriptHash: this.config.contractHash,
        operation: "configureDrop",
        args: [
          integerArg(toIntegerLike(payload.creatorRef ?? 1, 1)),
          integerArg(toIntegerLike(payload.collectionId, 0)),
          boolArg(payload.enabled),
          integerArg(payload.startAt ?? 0),
          integerArg(payload.endAt ?? 0),
          integerArg(payload.perWalletLimit ?? 0),
          boolArg(payload.whitelistRequired ?? false),
        ],
      };
    }

    if (this.dialect === "solidity") {
      return {
        scriptHash: this.config.contractHash,
        operation: "configureDrop",
        args: [
          integerArg(payload.collectionId),
          boolArg(payload.enabled),
          integerArg(payload.startAt ?? 0),
          integerArg(payload.endAt ?? 0),
          integerArg(payload.perWalletLimit ?? 0),
          boolArg(payload.whitelistRequired ?? false),
        ],
      };
    }

    return {
      scriptHash: this.config.contractHash,
      operation: "configureDrop",
      args: [
        toByteArrayArg(payload.collectionId),
        boolArg(payload.enabled),
        integerArg(payload.startAt ?? 0),
        integerArg(payload.endAt ?? 0),
        integerArg(payload.perWalletLimit ?? 0),
        boolArg(payload.whitelistRequired ?? false),
      ],
    };
  }

  buildConfigureCheckInProgramInvoke(payload: ConfigureCheckInProgramRequest): WalletInvokeRequest {
    if (this.dialect === "rust") {
      return {
        scriptHash: this.config.contractHash,
        operation: "configureCheckInProgram",
        args: [
          integerArg(toIntegerLike(payload.creatorRef ?? 1, 1)),
          integerArg(toIntegerLike(payload.collectionId, 0)),
          boolArg(payload.enabled),
          boolArg(payload.membershipRequired ?? true),
          boolArg(payload.membershipSoulbound ?? false),
          integerArg(payload.startAt ?? 0),
          integerArg(payload.endAt ?? 0),
          integerArg(payload.intervalSeconds ?? 0),
          integerArg(payload.maxCheckInsPerWallet ?? 0),
          boolArg(payload.mintProofNft ?? true),
        ],
      };
    }

    if (this.dialect === "solidity") {
      return {
        scriptHash: this.config.contractHash,
        operation: "configureCheckInProgram",
        args: [
          integerArg(payload.collectionId),
          boolArg(payload.enabled),
          boolArg(payload.membershipRequired ?? true),
          boolArg(payload.membershipSoulbound ?? false),
          integerArg(payload.startAt ?? 0),
          integerArg(payload.endAt ?? 0),
          integerArg(payload.intervalSeconds ?? 0),
          integerArg(payload.maxCheckInsPerWallet ?? 0),
          boolArg(payload.mintProofNft ?? true),
        ],
      };
    }

    return {
      scriptHash: this.config.contractHash,
      operation: "configureCheckInProgram",
      args: [
        toByteArrayArg(payload.collectionId),
        boolArg(payload.enabled),
        boolArg(payload.membershipRequired ?? true),
        boolArg(payload.membershipSoulbound ?? false),
        integerArg(payload.startAt ?? 0),
        integerArg(payload.endAt ?? 0),
        integerArg(payload.intervalSeconds ?? 0),
        integerArg(payload.maxCheckInsPerWallet ?? 0),
        boolArg(payload.mintProofNft ?? true),
      ],
    };
  }

  buildSetDropWhitelistInvoke(payload: SetDropWhitelistRequest): WalletInvokeRequest {
    if (this.dialect === "rust") {
      return {
        scriptHash: this.config.contractHash,
        operation: "setDropWhitelist",
        args: [
          integerArg(toIntegerLike(payload.creatorRef ?? 1, 1)),
          integerArg(toIntegerLike(payload.collectionId, 0)),
          integerArg(toIntegerLike(payload.accountRef ?? payload.account, 0)),
          integerArg(payload.allowance),
        ],
      };
    }

    if (this.dialect === "solidity") {
      return {
        scriptHash: this.config.contractHash,
        operation: "setDropWhitelist",
        args: [integerArg(payload.collectionId), hash160Arg(payload.account), integerArg(payload.allowance)],
      };
    }

    return {
      scriptHash: this.config.contractHash,
      operation: "setDropWhitelist",
      args: [toByteArrayArg(payload.collectionId), hash160Arg(payload.account), integerArg(payload.allowance)],
    };
  }

  buildSetDropWhitelistBatchInvoke(payload: SetDropWhitelistBatchRequest): WalletInvokeRequest {
    if (this.dialect === "rust") {
      throw new Error("setDropWhitelistBatch is not supported by Rust invoke adapter");
    }

    if (this.dialect === "solidity") {
      return {
        scriptHash: this.config.contractHash,
        operation: "setDropWhitelistBatch",
        args: [
          integerArg(payload.collectionId),
          arrayArg(payload.entries.map((entry) => hash160Arg(entry.account))),
          arrayArg(payload.entries.map((entry) => integerArg(entry.allowance))),
        ],
      };
    }

    return {
      scriptHash: this.config.contractHash,
      operation: "setDropWhitelistBatch",
      args: [
        toByteArrayArg(payload.collectionId),
        arrayArg(payload.entries.map((entry) => hash160Arg(entry.account))),
        arrayArg(payload.entries.map((entry) => integerArg(entry.allowance))),
      ],
    };
  }

  buildClaimDropInvoke(payload: ClaimDropRequest): WalletInvokeRequest {
    if (this.dialect === "rust") {
      return {
        scriptHash: this.config.contractHash,
        operation: "claimDrop",
        args: [
          integerArg(toIntegerLike(payload.claimerRef ?? 1, 1)),
          integerArg(toIntegerLike(payload.collectionId, 0)),
          integerArg(toIntegerLike(payload.tokenUriRef ?? payload.tokenUri ?? 0, 0)),
          integerArg(toIntegerLike(payload.propertiesRef ?? payload.propertiesJson ?? 0, 0)),
        ],
      };
    }

    if (this.dialect === "solidity") {
      return {
        scriptHash: this.config.contractHash,
        operation: "claimDrop",
        args: [
          integerArg(payload.collectionId),
          stringArg(payload.tokenUri ?? ""),
          toByteArrayArg(payload.propertiesJson ?? ""),
        ],
      };
    }

    return {
      scriptHash: this.config.contractHash,
      operation: "claimDrop",
      args: [
        toByteArrayArg(payload.collectionId),
        stringArg(payload.tokenUri ?? ""),
        stringArg(payload.propertiesJson ?? ""),
      ],
    };
  }

  buildCheckInInvoke(payload: CheckInRequest): WalletInvokeRequest {
    if (this.dialect === "rust") {
      return {
        scriptHash: this.config.contractHash,
        operation: "checkIn",
        args: [
          integerArg(toIntegerLike(payload.claimerRef ?? 1, 1)),
          integerArg(toIntegerLike(payload.collectionId, 0)),
          integerArg(toIntegerLike(payload.tokenUriRef ?? payload.tokenUri ?? 0, 0)),
          integerArg(toIntegerLike(payload.propertiesRef ?? payload.propertiesJson ?? 0, 0)),
        ],
      };
    }

    if (this.dialect === "solidity") {
      return {
        scriptHash: this.config.contractHash,
        operation: "checkIn",
        args: [
          integerArg(payload.collectionId),
          stringArg(payload.tokenUri ?? ""),
          toByteArrayArg(payload.propertiesJson ?? ""),
        ],
      };
    }

    return {
      scriptHash: this.config.contractHash,
      operation: "checkIn",
      args: [
        toByteArrayArg(payload.collectionId),
        stringArg(payload.tokenUri ?? ""),
        stringArg(payload.propertiesJson ?? ""),
      ],
    };
  }
}
