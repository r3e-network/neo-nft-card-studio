import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";

import type { ApiNetworkName, AppConfig } from "../config";
import type { IndexerService } from "../services/indexer";
import { AppDb } from "../db";
import { resolveNeoFsUri } from "../services/neofs";

const queryLimitSchema = z.object({
  limit: z.coerce.number().int().positive().max(500).default(100),
});
const queryUriSchema = z.object({
  uri: z.string().trim().min(1).max(4096),
});

interface ManifestMethodSummary {
  name: string;
  parameterTypes: string[];
  returnType: string;
}

interface GhostMarketCompatibilityIssue {
  code: string;
  message: string;
  params?: Record<string, string>;
}

function normalizeMethodName(name: string): string {
  return name.replace(/_/g, "").toLowerCase();
}

function normalizeContractHash(hash: string): string {
  return hash.startsWith("0x") ? hash.toLowerCase() : `0x${hash.toLowerCase()}`;
}

function findMethod(methods: ManifestMethodSummary[], methodName: string): ManifestMethodSummary | null {
  const target = normalizeMethodName(methodName);
  return methods.find((method) => normalizeMethodName(method.name) === target) ?? null;
}

function returnTypeMatches(actual: string, expected: string[]): boolean {
  const normalized = actual.toLowerCase();
  return expected.some((entry) => entry.toLowerCase() === normalized);
}

function paramTypeMatches(actual: string, expected: string[]): boolean {
  const normalized = actual.toLowerCase();
  return expected.some((entry) => entry.toLowerCase() === normalized);
}

function methodHasIntegerParam(methods: ManifestMethodSummary[], methodName: string, paramIndex: number): boolean {
  const method = findMethod(methods, methodName);
  if (!method || method.parameterTypes.length <= paramIndex) {
    return false;
  }

  return paramTypeMatches(method.parameterTypes[paramIndex], ["Integer"]);
}

function fillGhostMarketTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_whole, key) => values[key] ?? "");
}

function evaluateGhostMarketCompatibility(input: {
  dialect: "csharp" | "solidity" | "rust";
  supportedStandards: string[];
  methods: ManifestMethodSummary[];
}): {
  compatible: boolean;
  reasons: string[];
  warnings: string[];
  reasonIssues: GhostMarketCompatibilityIssue[];
  warningIssues: GhostMarketCompatibilityIssue[];
} {
  const reasons: GhostMarketCompatibilityIssue[] = [];
  const warnings: GhostMarketCompatibilityIssue[] = [];
  const standards = new Set(input.supportedStandards.map((entry) => entry.toUpperCase()));
  const isFactoryContract = !!findMethod(input.methods, "deployCollectionContractFromTemplate")
    && !findMethod(input.methods, "ownerOf")
    && !findMethod(input.methods, "tokenURI");

  if (isFactoryContract) {
    reasons.push({
      code: "factory_contract_not_nft",
      message: "This contract is an NFT deployment factory, not an NFT asset contract.",
    });

    return {
      compatible: false,
      reasons: reasons.map((issue) => issue.message),
      warnings: warnings.map((issue) => issue.message),
      reasonIssues: reasons,
      warningIssues: warnings,
    };
  }

  if (!standards.has("NEP-11")) {
    reasons.push({
      code: "missing_standard_nep11",
      message: "Manifest does not declare NEP-11 in supported standards.",
    });
  }

  if (!standards.has("NEP-24")) {
    warnings.push({
      code: "missing_standard_nep24",
      message: "Manifest does not declare NEP-24. Some marketplaces may rely on royalty fallbacks.",
    });
  }

  const ownerOfMethod = findMethod(input.methods, "ownerOf");
  if (!ownerOfMethod) {
    reasons.push({
      code: "missing_method_owner_of",
      message: "Missing required method: ownerOf.",
    });
  } else {
    if (ownerOfMethod.parameterTypes.length !== 1) {
      reasons.push({
        code: "owner_of_param_count",
        message: "ownerOf must accept exactly one tokenId argument.",
      });
    } else if (
      !paramTypeMatches(ownerOfMethod.parameterTypes[0], [
        "ByteArray",
        "ByteString",
        "Buffer",
        "Hash256",
        "Any",
      ])
    ) {
      reasons.push({
        code: "owner_of_param_type",
        message: `ownerOf tokenId type is ${ownerOfMethod.parameterTypes[0]}, expected ByteArray/Hash256-compatible token id.`,
        params: {
          actualType: ownerOfMethod.parameterTypes[0],
        },
      });
    }

    if (!returnTypeMatches(ownerOfMethod.returnType, ["Hash160", "ByteArray", "ByteString", "Any"])) {
      reasons.push({
        code: "owner_of_return_type",
        message: `ownerOf return type is ${ownerOfMethod.returnType}, expected Hash160-compatible owner type.`,
        params: {
          actualType: ownerOfMethod.returnType,
        },
      });
    }
  }

  const tokenUriMethod = findMethod(input.methods, "tokenURI");
  if (!tokenUriMethod) {
    reasons.push({
      code: "missing_method_token_uri",
      message: "Missing required method: tokenURI.",
    });
  } else {
    if (tokenUriMethod.parameterTypes.length !== 1) {
      reasons.push({
        code: "token_uri_param_count",
        message: "tokenURI must accept exactly one tokenId argument.",
      });
    } else if (
      !paramTypeMatches(tokenUriMethod.parameterTypes[0], [
        "ByteArray",
        "ByteString",
        "Buffer",
        "Hash256",
        "Any",
      ])
    ) {
      reasons.push({
        code: "token_uri_param_type",
        message: `tokenURI tokenId type is ${tokenUriMethod.parameterTypes[0]}, expected ByteArray/Hash256-compatible token id.`,
        params: {
          actualType: tokenUriMethod.parameterTypes[0],
        },
      });
    }

    if (!returnTypeMatches(tokenUriMethod.returnType, ["String", "ByteString", "ByteArray", "Any"])) {
      reasons.push({
        code: "token_uri_return_type",
        message: `tokenURI return type is ${tokenUriMethod.returnType}, expected String-like metadata URI.`,
        params: {
          actualType: tokenUriMethod.returnType,
        },
      });
    }
  }

  const propertiesMethod = findMethod(input.methods, "properties");
  if (!propertiesMethod) {
    reasons.push({
      code: "missing_method_properties",
      message: "Missing required method: properties.",
    });
  } else {
    if (propertiesMethod.parameterTypes.length !== 1) {
      reasons.push({
        code: "properties_param_count",
        message: "properties must accept exactly one tokenId argument.",
      });
    }
    if (!returnTypeMatches(propertiesMethod.returnType, ["Map", "Array", "Any", "ByteString", "ByteArray"])) {
      reasons.push({
        code: "properties_return_type",
        message: `properties return type is ${propertiesMethod.returnType}, expected metadata payload (Map/Array/ByteString/Any).`,
        params: {
          actualType: propertiesMethod.returnType,
        },
      });
    }
  }

  const royaltiesMethod = findMethod(input.methods, "getRoyalties");
  if (!royaltiesMethod) {
    reasons.push({
      code: "missing_method_get_royalties",
      message: "Missing GhostMarket extension method: getRoyalties(tokenId).",
    });
  } else {
    if (royaltiesMethod.parameterTypes.length !== 1) {
      reasons.push({
        code: "get_royalties_param_count",
        message: "getRoyalties must accept exactly one tokenId argument.",
      });
    }
    if (!returnTypeMatches(royaltiesMethod.returnType, ["String", "ByteString", "ByteArray", "Any"])) {
      reasons.push({
        code: "get_royalties_return_type",
        message: `getRoyalties return type is ${royaltiesMethod.returnType}, expected serialized royalties payload.`,
        params: {
          actualType: royaltiesMethod.returnType,
        },
      });
    }
  }

  const transferMethod = findMethod(input.methods, "transfer");
  if (!transferMethod) {
    reasons.push({
      code: "missing_method_transfer",
      message: "Missing required method: transfer.",
    });
  } else {
    if (transferMethod.parameterTypes.length < 3) {
      reasons.push({
        code: "transfer_param_count",
        message: "transfer should accept (to, tokenId, data).",
      });
    }
    if (!returnTypeMatches(transferMethod.returnType, ["Boolean", "Bool", "Any"])) {
      reasons.push({
        code: "transfer_return_type",
        message: "transfer return type should be Boolean.",
      });
    }
  }

  const onPaymentMethod = findMethod(input.methods, "onNEP11Payment");
  if (!onPaymentMethod) {
    warnings.push({
      code: "missing_method_on_nep11_payment",
      message: "Missing onNEP11Payment handler. Receiving transfers from other NEP-11 contracts may fail.",
    });
  } else if (onPaymentMethod.parameterTypes.length < 4) {
    warnings.push({
      code: "on_nep11_payment_param_count",
      message: "onNEP11Payment should accept (from, amount, tokenId, data).",
    });
  }

  const integerTokenRefMethods: string[] = [];
  if (methodHasIntegerParam(input.methods, "ownerOf", 0)) {
    integerTokenRefMethods.push("ownerOf(tokenId)");
  }
  if (methodHasIntegerParam(input.methods, "tokenURI", 0)) {
    integerTokenRefMethods.push("tokenURI(tokenId)");
  }
  if (methodHasIntegerParam(input.methods, "properties", 0)) {
    integerTokenRefMethods.push("properties(tokenId)");
  }
  if (methodHasIntegerParam(input.methods, "getRoyalties", 0)) {
    integerTokenRefMethods.push("getRoyalties(tokenId)");
  }
  if (methodHasIntegerParam(input.methods, "royaltyInfo", 0)) {
    integerTokenRefMethods.push("royaltyInfo(tokenId, ...)");
  }
  if (methodHasIntegerParam(input.methods, "transfer", 1)) {
    integerTokenRefMethods.push("transfer(to, tokenId, data)");
  }

  if (integerTokenRefMethods.length > 0) {
    warnings.push({
      code: "integer_token_ref_methods",
      message: `Core NFT methods still expose Integer token references (${integerTokenRefMethods.join(
        ", ",
      )}). Marketplace compatibility is likely partial until typed token ABI is exposed.`,
      params: {
        methods: integerTokenRefMethods.join(", "),
      },
    });
  }

  return {
    compatible: reasons.length === 0,
    reasons: reasons.map((issue) => issue.message),
    warnings: warnings.map((issue) => issue.message),
    reasonIssues: reasons,
    warningIssues: warnings,
  };
}

export interface ApiRouteNetworkContext {
  network: ApiNetworkName;
  db: AppDb;
  indexer: IndexerService;
  config: AppConfig;
}

type ApiRouteNetworkContextMap = Partial<Record<ApiNetworkName, ApiRouteNetworkContext>>;

const API_NETWORKS: ApiNetworkName[] = ["mainnet", "testnet", "private"];

function isApiNetworkName(value: string): value is ApiNetworkName {
  return API_NETWORKS.includes(value as ApiNetworkName);
}

function readNetworkQueryValue(input: unknown): string | null {
  if (typeof input === "string") {
    const value = input.trim().toLowerCase();
    return value.length > 0 ? value : null;
  }

  if (Array.isArray(input)) {
    return readNetworkQueryValue(input[0]);
  }

  return null;
}

function readContractHashQueryValue(input: unknown): string | null {
  if (typeof input === "string") {
    const value = input.trim();
    return value.length > 0 ? value : null;
  }

  if (Array.isArray(input)) {
    return readContractHashQueryValue(input[0]);
  }

  return null;
}

export function createHttpRouter(networkContexts: ApiRouteNetworkContextMap, config: AppConfig): Router {
  const router = Router();
  const availableNetworks = API_NETWORKS.filter((network) => !!networkContexts[network]);
  const NEOFS_METADATA_MAX_BYTES = 1024 * 1024;
  const NEOFS_RESOURCE_MAX_BYTES = 20 * 1024 * 1024;
  const NEOFS_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
  const NEOFS_LOCAL_STORE_MAX_ENTRIES = 500;
  const localNeoFsStore = new Map<string, { contentType: string; bodyText?: string; body?: Buffer }>();

  function resolveContextOrReply(req: Request, res: Response): ApiRouteNetworkContext | null {
    const rawNetwork = readNetworkQueryValue(req.query.network);
    const selectedNetwork = rawNetwork ?? config.NEO_DEFAULT_NETWORK;

    if (!isApiNetworkName(selectedNetwork)) {
      res.status(400).json({
        message: "Invalid network query value",
        requestedNetwork: rawNetwork,
        defaultNetwork: config.NEO_DEFAULT_NETWORK,
        availableNetworks,
      });
      return null;
    }

    const context = networkContexts[selectedNetwork];
    if (!context) {
      res.status(404).json({
        message: `Network '${selectedNetwork}' is not configured on this API instance`,
        requestedNetwork: selectedNetwork,
        defaultNetwork: config.NEO_DEFAULT_NETWORK,
        availableNetworks,
      });
      return null;
    }

    return context;
  }

  function withNetworkContext(
    handler: (context: ApiRouteNetworkContext, req: Request, res: Response) => void | Promise<void>,
  ) {
    return async (req: Request, res: Response, next: NextFunction) => {
      const context = resolveContextOrReply(req, res);
      if (!context) {
        return;
      }

      try {
        await handler(context, req, res);
      } catch (error) {
        next(error);
      }
    };
  }

  async function fetchNeoFsMetadata(uri: string): Promise<{
    status: number;
    contentType: string;
    bodyText: string;
  }> {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), config.NEOFS_METADATA_TIMEOUT_MS);

    try {
      const response = await fetch(uri, {
        method: "GET",
        headers: {
          Accept: "application/json,text/plain;q=0.8,*/*;q=0.2",
        },
        signal: abortController.signal,
      });

      const contentType = response.headers.get("content-type") ?? "";
      const bodyText = await response.text();
      return {
        status: response.status,
        contentType,
        bodyText,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function fetchNeoFsResource(uri: string): Promise<{
    status: number;
    contentType: string;
    cacheControl: string;
    body: Buffer;
  }> {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), config.NEOFS_METADATA_TIMEOUT_MS);

    try {
      const response = await fetch(uri, {
        method: "GET",
        headers: {
          Accept: "*/*",
        },
        signal: abortController.signal,
      });

      const contentType = response.headers.get("content-type") ?? "application/octet-stream";
      const cacheControl = response.headers.get("cache-control") ?? "public, max-age=120";
      const body = Buffer.from(await response.arrayBuffer());

      return {
        status: response.status,
        contentType,
        cacheControl,
        body,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  router.get(
    "/health",
    withNetworkContext(async (context, _req, res) => {
      const chainBlockHeight = await context.indexer.getChainBlockHeight();

      res.json({
        status: "ok",
        network: context.network,
        defaultNetwork: config.NEO_DEFAULT_NETWORK,
        availableNetworks,
        contract: {
          hash: context.config.NEO_CONTRACT_HASH,
          dialect: context.config.NEO_CONTRACT_DIALECT,
        },
        endpoint: {
          rpcUrl: context.config.NEO_RPC_URL,
          chainBlockHeight,
          reachable: typeof chainBlockHeight === "number",
        },
        stats: context.db.getStats(),
        timestamp: new Date().toISOString(),
      });
    }),
  );

  router.get(
    "/meta/contract",
    withNetworkContext((context, _req, res) => {
      res.json({
        network: context.network,
        defaultNetwork: config.NEO_DEFAULT_NETWORK,
        availableNetworks,
        hash: context.config.NEO_CONTRACT_HASH,
        dialect: context.config.NEO_CONTRACT_DIALECT,
        eventIndexingEnabled: context.indexer.isEventIndexingEnabled(),
        rpcUrl: context.config.NEO_RPC_URL,
        ghostMarketEnabled: context.config.GHOSTMARKET_ENABLED,
      });
    }),
  );

  router.get(
    "/meta/neofs",
    withNetworkContext((context, _req, res) => {
      res.json({
        network: context.network,
        defaultNetwork: config.NEO_DEFAULT_NETWORK,
        availableNetworks,
        enabled: config.NEOFS_ENABLED,
        gatewayBaseUrl: config.NEOFS_GATEWAY_BASE_URL,
        objectUrlTemplate: config.NEOFS_OBJECT_URL_TEMPLATE,
        containerUrlTemplate: config.NEOFS_CONTAINER_URL_TEMPLATE,
        metadataTimeoutMs: config.NEOFS_METADATA_TIMEOUT_MS,
        checkedAt: new Date().toISOString(),
      });
    }),
  );

  router.get("/meta/neofs/resolve", withNetworkContext((context, req, res) => {
    if (!config.NEOFS_ENABLED) {
      res.status(503).json({ message: "NeoFS integration is disabled" });
      return;
    }

    const parsed = queryUriSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid query", error: parsed.error.flatten() });
      return;
    }

    const resolution = resolveNeoFsUri(parsed.data.uri, config);
    if (resolution.isNeoFs && resolution.containerId === "local_demo") {
      // Mock local resolve
      res.json({
        network: context.network,
        enabled: config.NEOFS_ENABLED,
        ...resolution,
        resolvedUri: resolution.originalUri, // Bypass gateway
        checkedAt: new Date().toISOString(),
      });
      return;
    }

    res.json({
      network: context.network,
      enabled: config.NEOFS_ENABLED,
      ...resolution,
      checkedAt: new Date().toISOString(),
    });
  }));

  router.post("/meta/neofs/upload", withNetworkContext((context, req, res) => {
    if (!config.NEOFS_ENABLED) {
      res.status(503).json({ message: "NeoFS integration is disabled" });
      return;
    }

    const { type, content } = req.body;
    if (!content || !type || typeof content !== "string") {
      res.status(400).json({ message: "Missing type or base64 content" });
      return;
    }

    let base64 = content;
    if (content.includes("base64,")) {
      base64 = content.split("base64,")[1];
    }

    let buffer: Buffer;
    try {
      buffer = Buffer.from(base64, "base64");
    } catch {
      res.status(400).json({ message: "Invalid base64 payload" });
      return;
    }

    if (buffer.length === 0) {
      res.status(400).json({ message: "Decoded payload is empty" });
      return;
    }

    if (buffer.length > NEOFS_UPLOAD_MAX_BYTES) {
      res.status(413).json({
        message: "Upload payload is too large",
        maxBytes: NEOFS_UPLOAD_MAX_BYTES,
        actualBytes: buffer.length,
      });
      return;
    }

    const isJson = type.includes("json");
    const containerId = "local_demo";
    const objectId = Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
    const uri = `neofs://${containerId}/${objectId}`;

    while (localNeoFsStore.size >= NEOFS_LOCAL_STORE_MAX_ENTRIES) {
      const oldestKey = localNeoFsStore.keys().next().value as string | undefined;
      if (!oldestKey) {
        break;
      }
      localNeoFsStore.delete(oldestKey);
    }

    localNeoFsStore.set(objectId, {
      contentType: type,
      body: isJson ? undefined : buffer,
      bodyText: isJson ? buffer.toString("utf8") : undefined,
    });

    res.json({ network: context.network, uri, containerId, objectId });
  }));

  router.get("/meta/neofs/metadata", withNetworkContext(async (context, req, res) => {
    if (!config.NEOFS_ENABLED) {
      res.status(503).json({ message: "NeoFS integration is disabled" });
      return;
    }

    const parsed = queryUriSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid query", error: parsed.error.flatten() });
      return;
    }

    const resolution = resolveNeoFsUri(parsed.data.uri, config);
    if (!resolution.isNeoFs) {
      res.status(400).json({ message: "Only neofs:// URI is supported by this endpoint" });
      return;
    }

    if (resolution.containerId === "local_demo") {
      const stored = localNeoFsStore.get(resolution.objectId);
      if (!stored || !stored.bodyText) {
        res.status(404).json({ message: "Local demo object not found" });
        return;
      }
      let metadata: unknown;
      try {
        metadata = JSON.parse(stored.bodyText);
      } catch {
        res.status(502).json({
          message: "NeoFS metadata is not valid JSON",
          contentType: stored.contentType,
          uri: resolution.originalUri,
          resolvedUri: resolution.originalUri,
        });
        return;
      }
      res.json({
        network: context.network,
        uri: resolution.originalUri,
        resolvedUri: resolution.originalUri,
        containerId: resolution.containerId,
        objectId: resolution.objectId,
        contentType: stored.contentType,
        metadata,
        fetchedAt: new Date().toISOString(),
      });
      return;
    }

    try {
      const result = await fetchNeoFsMetadata(resolution.resolvedUri);
      if (result.status < 200 || result.status >= 300) {
        res.status(502).json({
          message: "NeoFS gateway request failed",
          gatewayStatus: result.status,
          uri: resolution.originalUri,
          resolvedUri: resolution.resolvedUri,
        });
        return;
      }

      if (Buffer.byteLength(result.bodyText, "utf8") > NEOFS_METADATA_MAX_BYTES) {
        res.status(413).json({
          message: "Metadata payload is too large",
          maxBytes: NEOFS_METADATA_MAX_BYTES,
          uri: resolution.originalUri,
          resolvedUri: resolution.resolvedUri,
        });
        return;
      }

      let metadata: unknown;
      try {
        metadata = JSON.parse(result.bodyText);
      } catch {
        res.status(502).json({
          message: "NeoFS metadata is not valid JSON",
          contentType: result.contentType,
          uri: resolution.originalUri,
          resolvedUri: resolution.resolvedUri,
        });
        return;
      }

      res.json({
        network: context.network,
        uri: resolution.originalUri,
        resolvedUri: resolution.resolvedUri,
        containerId: resolution.containerId,
        objectId: resolution.objectId,
        contentType: result.contentType,
        metadata,
        fetchedAt: new Date().toISOString(),
      });
    } catch (error) {
      const message =
        error instanceof Error && error.name === "AbortError"
          ? `NeoFS metadata request timed out after ${config.NEOFS_METADATA_TIMEOUT_MS}ms`
          : `NeoFS metadata request failed: ${error instanceof Error ? error.message : "unknown error"}`;
      res.status(502).json({
        message,
        network: context.network,
        uri: resolution.originalUri,
        resolvedUri: resolution.resolvedUri,
      });
    }
  }));

  router.get("/meta/neofs/resource", withNetworkContext(async (_context, req, res) => {
    if (!config.NEOFS_ENABLED) {
      res.status(503).json({ message: "NeoFS integration is disabled" });
      return;
    }

    const parsed = queryUriSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid query", error: parsed.error.flatten() });
      return;
    }

    const resolution = resolveNeoFsUri(parsed.data.uri, config);
    if (!resolution.isNeoFs) {
      res.status(400).json({ message: "Only neofs:// URI is supported by this endpoint" });
      return;
    }

    if (resolution.containerId === "local_demo") {
      const stored = localNeoFsStore.get(resolution.objectId);
      if (!stored || !stored.body) {
        res.status(404).json({ message: "Local demo resource not found" });
        return;
      }
      res.setHeader("Content-Type", stored.contentType);
      res.setHeader("Cache-Control", "public, max-age=120");
      res.setHeader("X-NeoFS-Original-Uri", resolution.originalUri);
      res.setHeader("X-NeoFS-Resolved-Uri", resolution.originalUri);
      res.status(200).send(stored.body);
      return;
    }

    try {
      const result = await fetchNeoFsResource(resolution.resolvedUri);
      if (result.status < 200 || result.status >= 300) {
        res.status(502).json({
          message: "NeoFS gateway request failed",
          gatewayStatus: result.status,
          uri: resolution.originalUri,
          resolvedUri: resolution.resolvedUri,
        });
        return;
      }

      if (result.body.length > NEOFS_RESOURCE_MAX_BYTES) {
        res.status(413).json({
          message: "NeoFS resource payload is too large",
          maxBytes: NEOFS_RESOURCE_MAX_BYTES,
          actualBytes: result.body.length,
          uri: resolution.originalUri,
          resolvedUri: resolution.resolvedUri,
        });
        return;
      }

      res.setHeader("Content-Type", result.contentType);
      res.setHeader("Cache-Control", result.cacheControl);
      res.setHeader("X-NeoFS-Original-Uri", resolution.originalUri);
      res.setHeader("X-NeoFS-Resolved-Uri", resolution.resolvedUri);
      res.status(200).send(result.body);
    } catch (error) {
      const message =
        error instanceof Error && error.name === "AbortError"
          ? `NeoFS resource request timed out after ${config.NEOFS_METADATA_TIMEOUT_MS}ms`
          : `NeoFS resource request failed: ${error instanceof Error ? error.message : "unknown error"}`;
      res.status(502).json({
        message,
        uri: resolution.originalUri,
        resolvedUri: resolution.resolvedUri,
      });
    }
  }));

  router.get(
    "/meta/ghostmarket",
    withNetworkContext(async (context, req, res) => {
      const platformContractHash = normalizeContractHash(context.config.NEO_CONTRACT_HASH);
      const requestedContractHash = readContractHashQueryValue(req.query.contractHash);
      const contractHash = requestedContractHash ? normalizeContractHash(requestedContractHash) : platformContractHash;
      let manifestSummary:
        | {
            supportedStandards: string[];
            methods: Array<{
              name: string;
              parameterTypes: string[];
              returnType: string;
            }>;
          }
        | null = null;
      try {
        manifestSummary = await context.indexer.getContractManifestSummary(contractHash);
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown RPC error";
        res.json({
          network: context.network,
          defaultNetwork: config.NEO_DEFAULT_NETWORK,
          availableNetworks,
          enabled: context.config.GHOSTMARKET_ENABLED,
          baseUrl: context.config.GHOSTMARKET_BASE_URL,
          contractHash,
          platformContractHash,
          isPlatformContract: contractHash === platformContractHash,
          manifestAvailable: false,
          manifestError: `Failed to read manifest via RPC: ${message}`,
          compatibility: {
            compatible: false,
            reasons: ["Manifest unavailable: failed to read contract manifest via RPC."],
            warnings: [],
            reasonIssues: [
              {
                code: "manifest_unavailable",
                message: "Manifest unavailable: failed to read contract manifest via RPC.",
                params: {
                  rpcError: message,
                },
              },
            ],
            warningIssues: [],
            checkedAt: new Date().toISOString(),
          },
          checkedAt: new Date().toISOString(),
        });
        return;
      }

      const compatibility = evaluateGhostMarketCompatibility({
        dialect: context.config.NEO_CONTRACT_DIALECT,
        supportedStandards: manifestSummary?.supportedStandards ?? [],
        methods: manifestSummary?.methods ?? [],
      });

      const collectionUrlTemplate = fillGhostMarketTemplate(context.config.GHOSTMARKET_COLLECTION_URL_TEMPLATE, {
        contractHash,
        collectionId: "{collectionId}",
        tokenId: "{tokenId}",
      });
      const tokenUrlTemplate = fillGhostMarketTemplate(context.config.GHOSTMARKET_TOKEN_URL_TEMPLATE, {
        contractHash,
        collectionId: "{collectionId}",
        tokenId: "{tokenId}",
      });

      res.json({
        network: context.network,
        defaultNetwork: config.NEO_DEFAULT_NETWORK,
        availableNetworks,
        enabled: context.config.GHOSTMARKET_ENABLED,
        baseUrl: context.config.GHOSTMARKET_BASE_URL,
        contractHash,
        platformContractHash,
        isPlatformContract: contractHash === platformContractHash,
        collectionUrlTemplate,
        tokenUrlTemplate,
        contractSearchUrl: `${context.config.GHOSTMARKET_BASE_URL}/?search=${encodeURIComponent(contractHash)}`,
        compatibility: {
          ...compatibility,
          checkedAt: new Date().toISOString(),
        },
        manifest: manifestSummary,
      });
    }),
  );

  router.get(
    "/meta/ghostmarket/collection/:collectionId",
    withNetworkContext((context, req, res) => {
      const requestedContractHash = readContractHashQueryValue(req.query.contractHash);
      const contractHash = requestedContractHash
        ? normalizeContractHash(requestedContractHash)
        : normalizeContractHash(context.config.NEO_CONTRACT_HASH);
      const url = fillGhostMarketTemplate(context.config.GHOSTMARKET_COLLECTION_URL_TEMPLATE, {
        contractHash,
        collectionId: req.params.collectionId,
        tokenId: "",
      });

      res.json({ network: context.network, url });
    }),
  );

  router.get(
    "/meta/ghostmarket/token/:tokenId",
    withNetworkContext((context, req, res) => {
      const requestedContractHash = readContractHashQueryValue(req.query.contractHash);
      const contractHash = requestedContractHash
        ? normalizeContractHash(requestedContractHash)
        : normalizeContractHash(context.config.NEO_CONTRACT_HASH);
      const url = fillGhostMarketTemplate(context.config.GHOSTMARKET_TOKEN_URL_TEMPLATE, {
        contractHash,
        collectionId: "",
        tokenId: req.params.tokenId,
      });

      res.json({ network: context.network, url });
    }),
  );

  router.get(
    "/stats",
    withNetworkContext((context, _req, res) => {
      res.json(context.db.getStats());
    }),
  );

  router.get(
    "/collections",
    withNetworkContext((context, req, res) => {
      const owner = typeof req.query.owner === "string" ? req.query.owner : undefined;
      res.json(context.db.listCollections(owner));
    }),
  );

  router.get(
    "/collections/:collectionId",
    withNetworkContext((context, req, res) => {
      const collection = context.db.getCollection(req.params.collectionId);
      if (!collection) {
        res.status(404).json({ message: "Collection not found" });
        return;
      }

      res.json(collection);
    }),
  );

  router.get(
    "/collections/:collectionId/tokens",
    withNetworkContext((context, req, res) => {
      res.json(context.db.listCollectionTokens(req.params.collectionId));
    }),
  );

  router.get(
    "/tokens/:tokenId",
    withNetworkContext((context, req, res) => {
      const token = context.db.getToken(req.params.tokenId);
      if (!token) {
        res.status(404).json({ message: "Token not found" });
        return;
      }

      res.json(token);
    }),
  );

  router.get(
    "/wallets/:address/tokens",
    withNetworkContext((context, req, res) => {
      res.json(context.db.listWalletTokens(req.params.address));
    }),
  );

  router.get(
    "/transfers",
    withNetworkContext((context, req, res) => {
      const parsed = queryLimitSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid query", error: parsed.error.flatten() });
        return;
      }

      const tokenId = typeof req.query.tokenId === "string" ? req.query.tokenId : undefined;
      res.json(context.db.listTransfers(tokenId, parsed.data.limit));
    }),
  );

  return router;
}
