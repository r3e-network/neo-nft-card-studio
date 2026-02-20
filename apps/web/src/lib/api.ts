import axios from "axios";

import { getRuntimeNetworkConfig } from "./runtime-network";
import type {
  CollectionDto,
  ContractMetaDto,
  GhostMarketMetaDto,
  HealthDto,
  NeoFsMetaDto,
  NeoFsMetadataDto,
  NeoFsResolveDto,
  StatsDto,
  TokenDto,
  TransferDto,
} from "./types";

const apiByBaseUrl = new Map<string, ReturnType<typeof axios.create>>();

function getApiClient() {
  const { apiBaseUrl } = getRuntimeNetworkConfig();
  const normalized = apiBaseUrl.trim();
  const cached = apiByBaseUrl.get(normalized);
  if (cached) {
    return cached;
  }

  const client = axios.create({
    baseURL: normalized,
    timeout: 15000,
  });
  apiByBaseUrl.set(normalized, client);
  return client;
}

function getNetworkQueryParams(
  params?: Record<string, string | number | boolean | undefined>,
): Record<string, string | number | boolean> | undefined {
  const runtime = getRuntimeNetworkConfig();
  const next: Record<string, string | number | boolean> = {};

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) {
        continue;
      }
      next[key] = value;
    }
  }

  if (runtime.network === "mainnet" || runtime.network === "testnet" || runtime.network === "private") {
    next.network = runtime.network;
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

export async function fetchHealth(): Promise<HealthDto> {
  const response = await getApiClient().get<HealthDto>("/health", {
    params: getNetworkQueryParams(),
  });
  return response.data;
}

export async function fetchContractMeta(): Promise<ContractMetaDto> {
  const response = await getApiClient().get<ContractMetaDto>("/meta/contract", {
    params: getNetworkQueryParams(),
  });
  return response.data;
}

export async function fetchGhostMarketMeta(): Promise<GhostMarketMetaDto> {
  const response = await getApiClient().get<GhostMarketMetaDto>("/meta/ghostmarket", {
    params: getNetworkQueryParams(),
  });
  return response.data;
}

export async function fetchNeoFsMeta(): Promise<NeoFsMetaDto> {
  const response = await getApiClient().get<NeoFsMetaDto>("/meta/neofs", {
    params: getNetworkQueryParams(),
  });
  return response.data;
}

export async function resolveNeoFsUri(uri: string): Promise<NeoFsResolveDto> {
  const response = await getApiClient().get<NeoFsResolveDto>("/meta/neofs/resolve", {
    params: getNetworkQueryParams({ uri }),
  });
  return response.data;
}

export async function fetchNeoFsMetadata(uri: string): Promise<NeoFsMetadataDto> {
  const response = await getApiClient().get<NeoFsMetadataDto>("/meta/neofs/metadata", {
    params: getNetworkQueryParams({ uri }),
  });
  return response.data;
}

export function getNeoFsResourceProxyUrl(uri: string): string {
  return getApiClient().getUri({
    url: "/meta/neofs/resource",
    params: getNetworkQueryParams({ uri }),
  });
}

export async function uploadToNeoFs(file: File): Promise<{ uri: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64Content = reader.result as string;
        const response = await getApiClient().post(
          "/meta/neofs/upload",
          {
            type: file.type || "application/octet-stream",
            content: base64Content,
          },
          {
            params: getNetworkQueryParams(),
          },
        );
        resolve(response.data);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
}

export async function fetchStats(): Promise<StatsDto> {
  const response = await getApiClient().get<StatsDto>("/stats", {
    params: getNetworkQueryParams(),
  });
  return response.data;
}

export async function fetchCollections(owner?: string): Promise<CollectionDto[]> {
  const response = await getApiClient().get<CollectionDto[]>("/collections", {
    params: getNetworkQueryParams(owner ? { owner } : undefined),
  });
  return response.data;
}

export async function fetchCollection(collectionId: string): Promise<CollectionDto> {
  const response = await getApiClient().get<CollectionDto>(`/collections/${collectionId}`, {
    params: getNetworkQueryParams(),
  });
  return response.data;
}

export async function fetchCollectionTokens(collectionId: string): Promise<TokenDto[]> {
  const response = await getApiClient().get<TokenDto[]>(`/collections/${collectionId}/tokens`, {
    params: getNetworkQueryParams(),
  });
  return response.data;
}

export async function fetchWalletTokens(address: string): Promise<TokenDto[]> {
  const response = await getApiClient().get<TokenDto[]>(`/wallets/${address}/tokens`, {
    params: getNetworkQueryParams(),
  });
  return response.data;
}

export async function fetchTransfers(tokenId?: string): Promise<TransferDto[]> {
  const response = await getApiClient().get<TransferDto[]>("/transfers", {
    params: getNetworkQueryParams(tokenId ? { tokenId } : undefined),
  });
  return response.data;
}
