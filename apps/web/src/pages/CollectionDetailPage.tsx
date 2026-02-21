import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Settings, UserPlus, Sparkles, Layers, Rocket, FolderOpen, ArrowUpRight, CalendarCheck } from "lucide-react";

import { useWallet } from "../hooks/useWallet";
import {
  fetchCollection,
  fetchCollectionTokens,
  fetchGhostMarketMeta,
  fetchNeoFsMeta,
  fetchNeoFsMetadata,
  getNeoFsResourceProxyUrl,
  resolveNeoFsUri,
} from "../lib/api";
import { toUserErrorMessage } from "../lib/errors";
import { getRuntimeNetworkConfig } from "../lib/runtime-network";
import { useRuntimeContractDialect } from "../lib/runtime-dialect";
import { getNftClientForHash, getPlatformClient } from "../lib/platformClient";
import type { CollectionDto, GhostMarketMetaDto, NeoFsMetaDto, TokenDto } from "../lib/types";

interface MintForm {
  to: string;
  tokenUri: string;
  propertiesJson: string;
  operatorRef: string;
  toRef: string;
  tokenUriRef: string;
  propertiesRef: string;
  transferDataRef: string;
  burnOperatorRef: string;
}

interface SettingsForm {
  description: string;
  baseUri: string;
  royaltyBps: string;
  transferable: boolean;
  paused: boolean;
  creatorRef: string;
  descriptionRef: string;
  baseUriRef: string;
}

interface OperatorForm {
  operator: string;
  enabled: boolean;
  creatorRef: string;
  operatorRef: string;
}

interface DropConfigForm {
  enabled: boolean;
  startAt: string;
  endAt: string;
  perWalletLimit: string;
  whitelistRequired: boolean;
}

interface DropWalletStatsState {
  claimed: string;
  whitelistAllowance: string;
  remaining: string;
  claimableNow: boolean;
}

interface CheckInProgramForm {
  enabled: boolean;
  membershipRequired: boolean;
  membershipSoulbound: boolean;
  startAt: string;
  endAt: string;
  intervalSeconds: string;
  maxCheckInsPerWallet: string;
  mintProofNft: boolean;
}

interface CheckInWalletStatsState {
  checkInCount: string;
  lastCheckInAt: string;
  remainingCheckIns: string;
  checkInNow: boolean;
}

interface MembershipStatusState {
  membershipBalance: string;
  isMember: boolean;
  membershipRequired: boolean;
  membershipSoulbound: boolean;
}

function defaultMintForm(address: string | null): MintForm {
  return {
    to: address ?? "",
    tokenUri: "",
    propertiesJson: '{"name":"","image":"","attributes":[]}',
    operatorRef: "1",
    toRef: "1",
    tokenUriRef: "2001",
    propertiesRef: "2002",
    transferDataRef: "0",
    burnOperatorRef: "1",
  };
}

function createSettingsForm(collection: CollectionDto | null): SettingsForm {
  return {
    description: collection?.description ?? "",
    baseUri: collection?.baseUri ?? "",
    royaltyBps: (collection?.royaltyBps ?? 0).toString(),
    transferable: Boolean(collection?.transferable),
    paused: Boolean(collection?.paused),
    creatorRef: "1",
    descriptionRef: "3001",
    baseUriRef: "3002",
  };
}

function defaultOperatorForm(address: string | null): OperatorForm {
  return {
    operator: address ?? "",
    enabled: true,
    creatorRef: "1",
    operatorRef: "1",
  };
}

function createRustFallbackCollection(collectionId: string, description: string): CollectionDto {
  const now = new Date().toISOString();
  return {
    collectionId,
    owner: "N/A",
    name: `Rust Collection #${collectionId}`,
    symbol: "RUST",
    description,
    baseUri: "N/A",
    maxSupply: "-",
    minted: "-",
    royaltyBps: 0,
    transferable: 1,
    paused: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function fillGhostMarketTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_whole, key) => values[key] ?? "");
}

function isZeroUInt160Hex(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "0x0000000000000000000000000000000000000000" || normalized === "0000000000000000000000000000000000000000";
}

function isNeoFsUri(value: string): boolean {
  return /^neofs:(\/\/)?/i.test(value.trim());
}

function pickMetadataMediaUri(metadata: unknown): string {
  if (!metadata || typeof metadata !== "object") {
    return "";
  }

  const record = metadata as Record<string, unknown>;
  const candidates = [
    record.image,
    record.image_url,
    record.imageUrl,
    record.animation_url,
    record.animationUrl,
    record.media,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  return "";
}

function resolveMetadataMediaUri(mediaUri: string, metadataResolvedUri: string): string {
  if (isNeoFsUri(mediaUri)) {
    return getNeoFsResourceProxyUrl(mediaUri);
  }

  if (/^https?:\/\//i.test(mediaUri) || /^data:/i.test(mediaUri)) {
    return mediaUri;
  }

  try {
    return new URL(mediaUri, metadataResolvedUri).toString();
  } catch {
    return mediaUri;
  }
}

function toNumericString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return value.toString();
  }
  return "0";
}

function formatCollectionMaxSupply(value: string): string {
  return value.trim() === "0" ? "∞" : value;
}

function isUnlimitedDropRemaining(value: string): boolean {
  const normalized = value.trim();
  return (
    normalized === "-1" ||
    normalized === "9223372036854775807" ||
    normalized === "115792089237316195423570985008687907853269984665640564039457584007913129639935"
  );
}

function formatDropRemaining(value: string): string {
  return isUnlimitedDropRemaining(value) ? "∞" : value;
}

function toBoolValue(value: unknown): boolean {
  if (value === true || value === "true" || value === "1" || value === 1) {
    return true;
  }
  return false;
}

function parseDropConfigForm(value: unknown): DropConfigForm | null {
  if (!Array.isArray(value) || value.length < 5) {
    return null;
  }

  return {
    enabled: toBoolValue(value[0]),
    startAt: toNumericString(value[1]),
    endAt: toNumericString(value[2]),
    perWalletLimit: toNumericString(value[3]),
    whitelistRequired: toBoolValue(value[4]),
  };
}

function parseDropWalletStats(value: unknown): DropWalletStatsState | null {
  if (!Array.isArray(value) || value.length < 4) {
    return null;
  }

  return {
    claimed: toNumericString(value[0]),
    whitelistAllowance: toNumericString(value[1]),
    remaining: toNumericString(value[2]),
    claimableNow: toBoolValue(value[3]),
  };
}

function parseCheckInProgramForm(value: unknown): CheckInProgramForm | null {
  if (!Array.isArray(value) || value.length < 8) {
    return null;
  }

  return {
    enabled: toBoolValue(value[0]),
    membershipRequired: toBoolValue(value[1]),
    membershipSoulbound: toBoolValue(value[2]),
    startAt: toNumericString(value[3]),
    endAt: toNumericString(value[4]),
    intervalSeconds: toNumericString(value[5]),
    maxCheckInsPerWallet: toNumericString(value[6]),
    mintProofNft: toBoolValue(value[7]),
  };
}

function parseCheckInWalletStats(value: unknown): CheckInWalletStatsState | null {
  if (!Array.isArray(value) || value.length < 4) {
    return null;
  }

  return {
    checkInCount: toNumericString(value[0]),
    lastCheckInAt: toNumericString(value[1]),
    remainingCheckIns: toNumericString(value[2]),
    checkInNow: toBoolValue(value[3]),
  };
}

function parseMembershipStatus(value: unknown): MembershipStatusState | null {
  if (!Array.isArray(value) || value.length < 4) {
    return null;
  }

  return {
    membershipBalance: toNumericString(value[0]),
    isMember: toBoolValue(value[1]),
    membershipRequired: toBoolValue(value[2]),
    membershipSoulbound: toBoolValue(value[3]),
  };
}

export function CollectionDetailPage() {
  const { collectionId = "" } = useParams();
  const wallet = useWallet();
  const { t } = useTranslation();

  const [collection, setCollection] = useState<CollectionDto | null>(null);
  const [tokens, setTokens] = useState<TokenDto[]>([]);
  const [ghostMarket, setGhostMarket] = useState<GhostMarketMetaDto | null>(null);
  const [neoFsMeta, setNeoFsMeta] = useState<NeoFsMetaDto | null>(null);
  const [resolvedCollectionBaseUri, setResolvedCollectionBaseUri] = useState<string>("");
  const [resolvedTokenUriById, setResolvedTokenUriById] = useState<Record<string, string>>({});
  const [metadataByTokenId, setMetadataByTokenId] = useState<Record<string, string>>({});
  const [mediaUriByTokenId, setMediaUriByTokenId] = useState<Record<string, string>>({});
  const [metadataLoadingTokenId, setMetadataLoadingTokenId] = useState<string>("");
  const [mintForm, setMintForm] = useState<MintForm>(defaultMintForm(wallet.address));
  const [settingsForm, setSettingsForm] = useState<SettingsForm>(() => createSettingsForm(null));
  const [operatorForm, setOperatorForm] = useState<OperatorForm>(() => defaultOperatorForm(wallet.address));
  const [recipientByToken, setRecipientByToken] = useState<Record<string, string>>({});
  const [templateDeployData, setTemplateDeployData] = useState<string>('{"collectionType":"independent"}');
  const [dropConfigForm, setDropConfigForm] = useState<DropConfigForm>({
    enabled: false,
    startAt: "0",
    endAt: "0",
    perWalletLimit: "0",
    whitelistRequired: false,
  });
  const [dropWhitelistInput, setDropWhitelistInput] = useState<string>("");
  const [dropClaimTokenUri, setDropClaimTokenUri] = useState<string>("");
  const [dropClaimPropertiesJson, setDropClaimPropertiesJson] = useState<string>('{"name":"","attributes":[]}');
  const [dropWalletStats, setDropWalletStats] = useState<DropWalletStatsState | null>(null);
  const [checkInProgramForm, setCheckInProgramForm] = useState<CheckInProgramForm>({
    enabled: false,
    membershipRequired: true,
    membershipSoulbound: false,
    startAt: "0",
    endAt: "0",
    intervalSeconds: "0",
    maxCheckInsPerWallet: "0",
    mintProofNft: true,
  });
  const [checkInWalletStats, setCheckInWalletStats] = useState<CheckInWalletStatsState | null>(null);
  const [membershipStatus, setMembershipStatus] = useState<MembershipStatusState | null>(null);
  const [checkInTokenUri, setCheckInTokenUri] = useState<string>("");
  const [checkInPropertiesJson, setCheckInPropertiesJson] = useState<string>('{"name":"","attributes":[{"trait_type":"type","value":"check-in-proof"}]}');
  const [templateConfigured, setTemplateConfigured] = useState(false);
  const [deployedCollectionContractHash, setDeployedCollectionContractHash] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");

  const runtimeDialect = useRuntimeContractDialect();
  const isRustDialect = runtimeDialect === "rust";
  const isCsharpDialect = runtimeDialect === "csharp";
  const hasDedicatedContract = Boolean(
    deployedCollectionContractHash && !isZeroUInt160Hex(deployedCollectionContractHash),
  );
  const supportsWalletLevelStats = !isCsharpDialect || hasDedicatedContract;
  const runtimeNetwork = getRuntimeNetworkConfig();

  const getActionClient = () => {
    if (isCsharpDialect && hasDedicatedContract) {
      return getNftClientForHash(deployedCollectionContractHash);
    }

    return getPlatformClient();
  };

  const isOwner = useMemo(() => {
    if (!collection || !wallet.address) {
      return false;
    }

    const normalizedOwner = collection.owner.trim();
    if (!normalizedOwner || normalizedOwner === "N/A") {
      return false;
    }

    return wallet.address.trim() === normalizedOwner;
  }, [wallet.address, collection]);

  const reload = async () => {
    setLoading(true);
    setError("");
    if (!wallet.address || !wallet.network || wallet.network.network === "unknown") {
      setCollection(null);
      setTokens([]);
      setGhostMarket(null);
      setNeoFsMeta(null);
      setResolvedCollectionBaseUri("");
      setResolvedTokenUriById({});
      setMetadataByTokenId({});
      setMediaUriByTokenId({});
      setTemplateConfigured(false);
      setDeployedCollectionContractHash("");
      setDropWalletStats(null);
      setCheckInWalletStats(null);
      setMembershipStatus(null);
      setLoading(false);
      setError(t("detail.err_connect_wallet_first"));
      return;
    }

    try {
      const [fetchedCollection, fetchedTokens, neoFsMetaResponse] = await Promise.all([
        fetchCollection(collectionId),
        fetchCollectionTokens(collectionId),
        fetchNeoFsMeta().catch(() => null),
      ]);
      setCollection(fetchedCollection);
      setTokens(fetchedTokens);
      setNeoFsMeta(neoFsMetaResponse);
      setSettingsForm(createSettingsForm(fetchedCollection));
      setMetadataByTokenId({});
      setMediaUriByTokenId({});

      if (isNeoFsUri(fetchedCollection.baseUri)) {
        try {
          const resolved = await resolveNeoFsUri(fetchedCollection.baseUri);
          setResolvedCollectionBaseUri(resolved.resolvedUri);
        } catch {
          setResolvedCollectionBaseUri(fetchedCollection.baseUri);
        }
      } else {
        setResolvedCollectionBaseUri(fetchedCollection.baseUri);
      }

      const resolvedTokenEntries = await Promise.all(
        fetchedTokens.map(async (token) => {
          if (!isNeoFsUri(token.uri)) {
            return [token.tokenId, token.uri] as const;
          }

          try {
            const resolved = await resolveNeoFsUri(token.uri);
            return [token.tokenId, resolved.resolvedUri] as const;
          } catch {
            return [token.tokenId, token.uri] as const;
          }
        }),
      );
      setResolvedTokenUriById(Object.fromEntries(resolvedTokenEntries));

      let resolvedContractHashForGhostMeta = fetchedCollection.contractHash ?? "";
      if (isCsharpDialect) {
        const client = getPlatformClient();
        const [templateReady, templateSegmentsReady, collectionContractHash] = await Promise.all([
          client.hasCollectionContractTemplate(),
          client.hasCollectionContractTemplateNameSegments().catch(() => false),
          client.getCollectionContract(collectionId),
        ]);

        setTemplateConfigured(templateReady && templateSegmentsReady);
        const indexedContractHash = fetchedCollection.contractHash ?? "";
        if (collectionContractHash && !isZeroUInt160Hex(collectionContractHash)) {
          setDeployedCollectionContractHash(collectionContractHash);
          resolvedContractHashForGhostMeta = collectionContractHash;
        } else if (indexedContractHash && !isZeroUInt160Hex(indexedContractHash)) {
          setDeployedCollectionContractHash(indexedContractHash);
          resolvedContractHashForGhostMeta = indexedContractHash;
        } else {
          setDeployedCollectionContractHash("");
          resolvedContractHashForGhostMeta = "";
        }
      } else {
        setTemplateConfigured(false);
        setDeployedCollectionContractHash("");
      }

      const ghostMeta = await fetchGhostMarketMeta(
        resolvedContractHashForGhostMeta && !isZeroUInt160Hex(resolvedContractHashForGhostMeta)
          ? resolvedContractHashForGhostMeta
          : undefined,
      ).catch(() => null);
      setGhostMarket(ghostMeta);
    } catch (err) {
      if (isRustDialect) {
        const fallbackCollection = createRustFallbackCollection(collectionId, t("detail.rust_fallback_description"));
        setCollection(fallbackCollection);
        setTokens([]);
        setNeoFsMeta(null);
        setResolvedCollectionBaseUri(fallbackCollection.baseUri);
        setResolvedTokenUriById({});
        setMetadataByTokenId({});
        setMediaUriByTokenId({});
        setSettingsForm(createSettingsForm(fallbackCollection));
        setTemplateConfigured(false);
        setDeployedCollectionContractHash("");
        setError(t("detail.err_rust_index_limited"));
      } else {
        setError(toUserErrorMessage(t, err));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, [collectionId, isCsharpDialect, isRustDialect, wallet.address, wallet.network?.network, wallet.network?.magic]);

  useEffect(() => {
    setMintForm((prev) => ({
      ...prev,
      to: prev.to || wallet.address || "",
    }));
    setOperatorForm((prev) => ({
      ...prev,
      operator: prev.operator || wallet.address || "",
    }));
  }, [wallet.address]);

  useEffect(() => {
    if (!collection) {
      setDropWalletStats(null);
      setCheckInWalletStats(null);
      setMembershipStatus(null);
      return;
    }

    if (isCsharpDialect && !hasDedicatedContract) {
      setDropWalletStats(null);
      setCheckInWalletStats(null);
      setMembershipStatus(null);
      return;
    }

    let cancelled = false;
    const loadProgramState = async () => {
      try {
        const client = getActionClient();
        const [dropConfigRaw, dropStatsRaw, checkInProgramRaw, checkInStatsRaw, membershipRaw] = await Promise.all([
          client.getDropConfig(collection.collectionId).catch(() => null),
          supportsWalletLevelStats && wallet.address
            ? client.getDropWalletStats(collection.collectionId, wallet.address).catch(() => null)
            : Promise.resolve(null),
          client.getCheckInProgram(collection.collectionId).catch(() => null),
          supportsWalletLevelStats && wallet.address
            ? client.getCheckInWalletStats(collection.collectionId, wallet.address).catch(() => null)
            : Promise.resolve(null),
          supportsWalletLevelStats && wallet.address
            ? client.getMembershipStatus(collection.collectionId, wallet.address).catch(() => null)
            : Promise.resolve(null),
        ]);

        if (cancelled) {
          return;
        }

        const parsedConfig = parseDropConfigForm(dropConfigRaw);
        if (parsedConfig) {
          setDropConfigForm(parsedConfig);
        } else {
          setDropConfigForm({
            enabled: false,
            startAt: "0",
            endAt: "0",
            perWalletLimit: "0",
            whitelistRequired: false,
          });
        }

        const parsedStats = parseDropWalletStats(dropStatsRaw);
        setDropWalletStats(parsedStats);

        const parsedCheckInProgram = parseCheckInProgramForm(checkInProgramRaw);
        if (parsedCheckInProgram) {
          setCheckInProgramForm(parsedCheckInProgram);
        } else {
          setCheckInProgramForm({
            enabled: false,
            membershipRequired: true,
            membershipSoulbound: false,
            startAt: "0",
            endAt: "0",
            intervalSeconds: "0",
            maxCheckInsPerWallet: "0",
            mintProofNft: true,
          });
        }

        setCheckInWalletStats(parseCheckInWalletStats(checkInStatsRaw));
        setMembershipStatus(parseMembershipStatus(membershipRaw));
      } catch {
        if (!cancelled) {
          setDropWalletStats(null);
          setCheckInWalletStats(null);
          setMembershipStatus(null);
        }
      }
    };

    void loadProgramState();

    return () => {
      cancelled = true;
    };
  }, [collection, wallet.address, hasDedicatedContract, deployedCollectionContractHash, isCsharpDialect]);

  const ghostCollectionUrl = useMemo(() => {
    if (!ghostMarket) {
      return "";
    }

    const contractHash = hasDedicatedContract ? deployedCollectionContractHash : ghostMarket.contractHash;
    return fillGhostMarketTemplate(ghostMarket.collectionUrlTemplate, {
      contractHash,
      collectionId,
      tokenId: "",
    });
  }, [ghostMarket, collectionId, hasDedicatedContract, deployedCollectionContractHash]);

  const requireDedicatedContractForCsharp = (): boolean => {
    if (isCsharpDialect && !hasDedicatedContract) {
      setError(t("detail.err_dedicated_contract_required"));
      return false;
    }
    return true;
  };

  const updateCollectionSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!wallet.address) {
      setError(t("detail.err_connect_wallet_first"));
      return;
    }

    if (!collection) {
      setError(t("detail.err_collection_not_found"));
      return;
    }

    try {
      setWorking(true);
      await wallet.sync();
      const client = getActionClient();
      const txid = await wallet.invoke(
        client.buildUpdateCollectionInvoke({
          collectionId: collection.collectionId,
          description: settingsForm.description,
          baseUri: settingsForm.baseUri,
          royaltyBps: Number(settingsForm.royaltyBps),
          transferable: settingsForm.transferable,
          paused: settingsForm.paused,
          creatorRef: settingsForm.creatorRef,
          descriptionRef: settingsForm.descriptionRef,
          baseUriRef: settingsForm.baseUriRef,
        }),
      );
      setMessage(t("detail.msg_collection_updated", { txid }));
      await reload();
    } catch (err) {
      setError(toUserErrorMessage(t, err));
    } finally {
      setWorking(false);
    }
  };

  const updateCollectionOperator = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!wallet.address) {
      setError(t("detail.err_connect_wallet_first"));
      return;
    }

    if (!collection) {
      setError(t("detail.err_collection_not_found"));
      return;
    }

    if (!operatorForm.operator) {
      setError(isRustDialect ? t("detail.err_operator_ref_required") : t("detail.err_operator_address_required"));
      return;
    }

    try {
      setWorking(true);
      await wallet.sync();
      const client = getActionClient();
      const txid = await wallet.invoke(
        client.buildSetCollectionOperatorInvoke({
          collectionId: collection.collectionId,
          operator: operatorForm.operator,
          enabled: operatorForm.enabled,
          creatorRef: operatorForm.creatorRef,
          operatorRef: operatorForm.operatorRef,
        }),
      );
      setMessage(t("detail.msg_operator_updated", { txid }));
      await reload();
    } catch (err) {
      setError(toUserErrorMessage(t, err));
    } finally {
      setWorking(false);
    }
  };

  const mintToken = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!wallet.address) {
      setError(t("detail.err_connect_wallet_first"));
      return;
    }

    if (isCsharpDialect && !hasDedicatedContract) {
      setError(t("detail.err_dedicated_contract_required"));
      return;
    }

    try {
      setWorking(true);
      await wallet.sync();
      const client = getActionClient();
      const txid = await wallet.invoke(
        client.buildMintInvoke({
          collectionId,
          to: mintForm.to,
          tokenUri: mintForm.tokenUri,
          propertiesJson: mintForm.propertiesJson,
          operatorRef: mintForm.operatorRef,
          toRef: mintForm.toRef,
          tokenUriRef: mintForm.tokenUriRef,
          propertiesRef: mintForm.propertiesRef,
        }),
      );
      setMessage(t("detail.msg_mint_submitted", { txid }));
      setMintForm(defaultMintForm(wallet.address));
      await reload();
    } catch (err) {
      setError(toUserErrorMessage(t, err));
    } finally {
      setWorking(false);
    }
  };

  const batchMint = async (amount: number) => {
    setError("");
    setMessage("");

    if (!wallet.address) {
      setError(t("detail.err_connect_wallet_first"));
      return;
    }

    if (!requireDedicatedContractForCsharp()) {
      return;
    }

    if (!Number.isInteger(amount) || amount <= 0) {
      setError(t("detail.err_batch_amount_invalid"));
      return;
    }

    try {
      setWorking(true);
      await wallet.sync();
      const client = getActionClient();
      const txid = await wallet.invoke(
        client.buildBatchMintInvoke({
          collectionId,
          to: mintForm.to,
          tokenUri: mintForm.tokenUri,
          propertiesJson: mintForm.propertiesJson,
          amount,
        }),
      );
      setMessage(t("detail.msg_batch_mint_submitted", { txid }));
      setMintForm(defaultMintForm(wallet.address));
      await reload();
    } catch (err) {
      setError(toUserErrorMessage(t, err));
    } finally {
      setWorking(false);
    }
  };

  const deployCollectionContractFromTemplate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!wallet.address) {
      setError(t("detail.err_connect_wallet_first"));
      return;
    }

    if (!isCsharpDialect) {
      setError(t("detail.err_template_only_csharp"));
      return;
    }

    let extraData: unknown = null;
    const trimmed = templateDeployData.trim();
    if (trimmed.length > 0) {
      try {
        extraData = JSON.parse(trimmed);
      } catch {
        setError(t("detail.err_extra_data_json"));
        return;
      }
    }

    try {
      setWorking(true);
      await wallet.sync();
      const client = getPlatformClient();
      const txid = await wallet.invoke(
        client.buildDeployCollectionContractFromTemplateInvoke({
          collectionId,
          extraData: extraData as
            | string
            | number
            | boolean
            | null
            | Array<unknown>
            | Record<string, unknown>,
        }),
      );
      setMessage(t("detail.msg_template_deploy_submitted", { txid }));
      await reload();
    } catch (err) {
      setError(toUserErrorMessage(t, err));
    } finally {
      setWorking(false);
    }
  };

  const configureDrop = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!wallet.address) {
      setError(t("detail.err_connect_wallet_first"));
      return;
    }

    if (!collection) {
      setError(t("detail.err_collection_not_found"));
      return;
    }

    if (!requireDedicatedContractForCsharp()) {
      return;
    }

    const startAt = Number(dropConfigForm.startAt || "0");
    const endAt = Number(dropConfigForm.endAt || "0");
    const perWalletLimit = Number(dropConfigForm.perWalletLimit || "0");
    if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || !Number.isFinite(perWalletLimit) || startAt < 0 || endAt < 0 || perWalletLimit < 0) {
      setError(t("detail.err_drop_invalid_numbers"));
      return;
    }

    try {
      setWorking(true);
      await wallet.sync();
      const client = getActionClient();
      const txid = await wallet.invoke(
        client.buildConfigureDropInvoke({
          collectionId,
          enabled: dropConfigForm.enabled,
          startAt,
          endAt,
          perWalletLimit,
          whitelistRequired: dropConfigForm.whitelistRequired,
          creatorRef: settingsForm.creatorRef,
        }),
      );
      setMessage(t("detail.msg_drop_config_submitted", { txid }));
      await reload();
    } catch (err) {
      setError(toUserErrorMessage(t, err));
    } finally {
      setWorking(false);
    }
  };

  const configureCheckInProgram = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!wallet.address) {
      setError(t("detail.err_connect_wallet_first"));
      return;
    }

    if (!collection) {
      setError(t("detail.err_collection_not_found"));
      return;
    }

    if (!requireDedicatedContractForCsharp()) {
      return;
    }

    const startAt = Number(checkInProgramForm.startAt || "0");
    const endAt = Number(checkInProgramForm.endAt || "0");
    const intervalSeconds = Number(checkInProgramForm.intervalSeconds || "0");
    const maxCheckInsPerWallet = Number(checkInProgramForm.maxCheckInsPerWallet || "0");
    if (
      !Number.isFinite(startAt) ||
      !Number.isFinite(endAt) ||
      !Number.isFinite(intervalSeconds) ||
      !Number.isFinite(maxCheckInsPerWallet) ||
      startAt < 0 ||
      endAt < 0 ||
      intervalSeconds < 0 ||
      maxCheckInsPerWallet < 0
    ) {
      setError(t("detail.err_check_in_invalid_numbers"));
      return;
    }

    try {
      setWorking(true);
      await wallet.sync();
      const client = getActionClient();
      const txid = await wallet.invoke(
        client.buildConfigureCheckInProgramInvoke({
          collectionId,
          enabled: checkInProgramForm.enabled,
          membershipRequired: checkInProgramForm.membershipRequired,
          membershipSoulbound: checkInProgramForm.membershipSoulbound,
          startAt,
          endAt,
          intervalSeconds,
          maxCheckInsPerWallet,
          mintProofNft: checkInProgramForm.mintProofNft,
          creatorRef: settingsForm.creatorRef,
        }),
      );
      setMessage(t("detail.msg_check_in_program_submitted", { txid }));
      await reload();
    } catch (err) {
      setError(toUserErrorMessage(t, err));
    } finally {
      setWorking(false);
    }
  };

  const updateDropWhitelist = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!wallet.address) {
      setError(t("detail.err_connect_wallet_first"));
      return;
    }

    if (!collection) {
      setError(t("detail.err_collection_not_found"));
      return;
    }

    if (!requireDedicatedContractForCsharp()) {
      return;
    }

    const lines = dropWhitelistInput
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (lines.length === 0) {
      setError(t("detail.err_drop_whitelist_empty"));
      return;
    }

    let entries: Array<{ account: string; allowance: number }> = [];
    try {
      entries = lines.map((line) => {
        const parts = line
          .split(/[,\s]+/)
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0);
        if (parts.length === 0) {
          throw new Error(t("detail.err_drop_whitelist_format"));
        }

        const account = parts[0];
        const allowance = Number(parts[1] ?? "1");
        if (!Number.isFinite(allowance) || allowance < 0) {
          throw new Error(t("detail.err_drop_whitelist_allowance"));
        }

        return {
          account,
          allowance,
        };
      });
    } catch (err) {
      setError(toUserErrorMessage(t, err));
      return;
    }

    if (isRustDialect && entries.length > 1) {
      setError(t("detail.err_drop_whitelist_rust_single"));
      return;
    }

    try {
      setWorking(true);
      await wallet.sync();
      const client = getActionClient();
      let txid = "";

      if (entries.length === 1) {
        txid = await wallet.invoke(
          client.buildSetDropWhitelistInvoke({
            collectionId,
            account: entries[0].account,
            allowance: entries[0].allowance,
            creatorRef: settingsForm.creatorRef,
            accountRef: entries[0].account,
          }),
        );
      } else {
        txid = await wallet.invoke(
          client.buildSetDropWhitelistBatchInvoke({
            collectionId,
            creatorRef: settingsForm.creatorRef,
            entries: entries.map((entry) => ({
              account: entry.account,
              allowance: entry.allowance,
              accountRef: entry.account,
            })),
          }),
        );
      }

      setMessage(t("detail.msg_drop_whitelist_submitted", { txid }));
      await reload();
    } catch (err) {
      setError(toUserErrorMessage(t, err));
    } finally {
      setWorking(false);
    }
  };

  const claimDrop = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!wallet.address) {
      setError(t("detail.err_connect_wallet_first"));
      return;
    }

    if (!collection) {
      setError(t("detail.err_collection_not_found"));
      return;
    }

    if (!requireDedicatedContractForCsharp()) {
      return;
    }

    try {
      setWorking(true);
      await wallet.sync();
      const client = getActionClient();
      const txid = await wallet.invoke(
        client.buildClaimDropInvoke(
          isRustDialect
            ? {
              collectionId,
              claimerRef: "1",
              tokenUriRef: dropClaimTokenUri || "0",
              propertiesRef: dropClaimPropertiesJson || "0",
            }
            : {
              collectionId,
              tokenUri: dropClaimTokenUri,
              propertiesJson: dropClaimPropertiesJson,
            },
        ),
      );
      setMessage(t("detail.msg_drop_claim_submitted", { txid }));
      await reload();
    } catch (err) {
      setError(toUserErrorMessage(t, err));
    } finally {
      setWorking(false);
    }
  };

  const submitCheckIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!wallet.address) {
      setError(t("detail.err_connect_wallet_first"));
      return;
    }

    if (!collection) {
      setError(t("detail.err_collection_not_found"));
      return;
    }

    if (!requireDedicatedContractForCsharp()) {
      return;
    }

    try {
      setWorking(true);
      await wallet.sync();
      const client = getActionClient();
      const txid = await wallet.invoke(
        client.buildCheckInInvoke(
          isRustDialect
            ? {
              collectionId,
              claimerRef: "1",
              tokenUriRef: checkInTokenUri || "0",
              propertiesRef: checkInPropertiesJson || "0",
            }
            : {
              collectionId,
              tokenUri: checkInTokenUri,
              propertiesJson: checkInPropertiesJson,
            },
        ),
      );
      setMessage(t("detail.msg_check_in_submitted", { txid }));
      await reload();
    } catch (err) {
      setError(toUserErrorMessage(t, err));
    } finally {
      setWorking(false);
    }
  };

  const transferToken = async (tokenId: string) => {
    setError("");
    setMessage("");

    if (!wallet.address) {
      setError(t("detail.err_connect_wallet_first"));
      return;
    }

    if (isCsharpDialect && !hasDedicatedContract) {
      setError(t("detail.err_dedicated_contract_required"));
      return;
    }

    const recipient = recipientByToken[tokenId];
    if (!recipient) {
      setError(isRustDialect ? t("detail.err_recipient_ref_required") : t("detail.err_recipient_address_required"));
      return;
    }

    try {
      setWorking(true);
      await wallet.sync();
      const client = getActionClient();
      const transferRequest = isRustDialect
        ? {
          toRef: recipient,
          dataRef: mintForm.transferDataRef,
        }
        : undefined;
      const txid = await wallet.invoke(
        client.buildTransferInvoke(recipient, tokenId, transferRequest),
      );
      setMessage(t("detail.msg_transfer_submitted", { txid }));
      await reload();
    } catch (err) {
      setError(toUserErrorMessage(t, err));
    } finally {
      setWorking(false);
    }
  };

  const burnToken = async (tokenId: string) => {
    setError("");
    setMessage("");

    if (!wallet.address) {
      setError(t("detail.err_connect_wallet_first"));
      return;
    }

    if (isCsharpDialect && !hasDedicatedContract) {
      setError(t("detail.err_dedicated_contract_required"));
      return;
    }

    try {
      setWorking(true);
      await wallet.sync();
      const client = getActionClient();
      const txid = await wallet.invoke(
        client.buildBurnInvoke({
          tokenId,
          operatorRef: mintForm.burnOperatorRef,
        }),
      );
      setMessage(t("detail.msg_burn_submitted", { txid }));
      await reload();
    } catch (err) {
      setError(toUserErrorMessage(t, err));
    } finally {
      setWorking(false);
    }
  };

  const loadTokenMetadata = async (token: TokenDto) => {
    setError("");
    setMessage("");

    if (!isNeoFsUri(token.uri)) {
      setError(t("detail.err_neofs_uri_required"));
      return;
    }

    try {
      setMetadataLoadingTokenId(token.tokenId);
      const result = await fetchNeoFsMetadata(token.uri);
      const text = JSON.stringify(result.metadata, null, 2);
      const mediaCandidate = pickMetadataMediaUri(result.metadata);
      setMetadataByTokenId((prev) => ({
        ...prev,
        [token.tokenId]: text,
      }));
      setMediaUriByTokenId((prev) => {
        if (!mediaCandidate) {
          const next = { ...prev };
          delete next[token.tokenId];
          return next;
        }

        return {
          ...prev,
          [token.tokenId]: resolveMetadataMediaUri(mediaCandidate, result.resolvedUri),
        };
      });
      setMessage(t("detail.msg_neofs_loaded", { tokenId: token.tokenId }));
    } catch (err) {
      setError(toUserErrorMessage(t, err));
    } finally {
      setMetadataLoadingTokenId("");
    }
  };

  if (loading) {
    return <p className="hint">{t("detail.loading")}</p>;
  }

  if (!collection) {
    return <p className="error">{t("detail.not_found")}</p>;
  }

  return (
    <section className="stack-lg fade-in">
      <article className="panel">
        <div className="panel-header" style={{ marginBottom: '1.5rem', paddingBottom: '1rem' }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Layers size={24} color="#00E599" />
            {collection.name} ({collection.symbol})
          </h2>
          <p className="hint">{collection.collectionId}</p>
        </div>
        {ghostMarket?.enabled && ghostCollectionUrl ? (
          <>
            <p className="hint">
              <a href={ghostCollectionUrl} target="_blank" rel="noreferrer">
                {t("detail.open_ghostmarket")}
              </a>
            </p>
            {!ghostMarket.compatibility.compatible ? (
              <p className="hint">{t("detail.ghost_partial")}</p>
            ) : null}
          </>
        ) : null}
        {neoFsMeta ? (
          <p className="hint">
            {t("detail.neofs_status")}: {neoFsMeta.enabled ? t("detail.yes") : t("detail.no")} ({neoFsMeta.gatewayBaseUrl})
          </p>
        ) : null}

        <div className="meta-grid">
          <div>
            <span className="meta-label">{t("detail.lbl_owner")}</span>
            <p>{collection.owner}</p>
          </div>
          <div>
            <span className="meta-label">{t("detail.lbl_supply")}</span>
            <p>
              {collection.minted} / {formatCollectionMaxSupply(collection.maxSupply)}
            </p>
          </div>
          <div>
            <span className="meta-label">{t("detail.lbl_royalty")}</span>
            <p>{collection.royaltyBps / 100}%</p>
          </div>
          <div>
            <span className="meta-label">{t("detail.lbl_transferable")}</span>
            <p>{collection.transferable ? t("detail.yes") : t("detail.no")}</p>
          </div>
          <div>
            <span className="meta-label">{t("detail.lbl_paused")}</span>
            <p>{collection.paused ? t("detail.yes") : t("detail.no")}</p>
          </div>
          <div>
            <span className="meta-label">{t("detail.lbl_base_uri")}</span>
            <p>{collection.baseUri}</p>
            {resolvedCollectionBaseUri && resolvedCollectionBaseUri !== collection.baseUri ? (
              <a href={resolvedCollectionBaseUri} target="_blank" rel="noreferrer" className="inline-link">
                {t("detail.open_resolved_uri")}
              </a>
            ) : null}
            {neoFsMeta?.enabled && isNeoFsUri(collection.baseUri) ? (
              <p className="hint">{t("detail.neofs_enabled")}</p>
            ) : null}
          </div>
        </div>
      </article>

      {isOwner ? (
        <>
          <article className="panel">
            <div className="panel-header" style={{ borderBottom: 'none', paddingBottom: 0 }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Settings size={18} /> {t("detail.settings")}
              </h3>
              <span className="hint">{t("detail.settings_hint")}</span>
            </div>
            <form className="form-grid" onSubmit={updateCollectionSettings}>
              {isRustDialect ? (
                <>
                  <label>
                    {t("detail.lbl_creator_ref")}
                    <input
                      required
                      type="number"
                      value={settingsForm.creatorRef}
                      onChange={(event) =>
                        setSettingsForm((prev) => ({
                          ...prev,
                          creatorRef: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    {t("detail.lbl_desc_ref")}
                    <input
                      required
                      type="number"
                      value={settingsForm.descriptionRef}
                      onChange={(event) =>
                        setSettingsForm((prev) => ({
                          ...prev,
                          descriptionRef: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="full">
                    {t("detail.lbl_base_uri_ref")}
                    <input
                      required
                      type="number"
                      value={settingsForm.baseUriRef}
                      onChange={(event) =>
                        setSettingsForm((prev) => ({
                          ...prev,
                          baseUriRef: event.target.value,
                        }))
                      }
                    />
                  </label>
                </>
              ) : (
                <>
                  <label className="full">
                    {t("detail.lbl_desc")}
                    <textarea
                      required
                      rows={3}
                      value={settingsForm.description}
                      onChange={(event) =>
                        setSettingsForm((prev) => ({
                          ...prev,
                          description: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="full">
                    {t("detail.lbl_base_uri")}
                    <input
                      required
                      value={settingsForm.baseUri}
                      onChange={(event) =>
                        setSettingsForm((prev) => ({
                          ...prev,
                          baseUri: event.target.value,
                        }))
                      }
                      placeholder={t("detail.ph_base_uri")}
                    />
                  </label>
                </>
              )}

              <label>
                {t("detail.lbl_royalty_bps")}
                <input
                  required
                  type="number"
                  min={0}
                  max={10000}
                  value={settingsForm.royaltyBps}
                  onChange={(event) =>
                    setSettingsForm((prev) => ({
                      ...prev,
                      royaltyBps: event.target.value,
                    }))
                  }
                />
              </label>

              <label className="switch">
                <input
                  type="checkbox"
                  checked={settingsForm.transferable}
                  onChange={(event) =>
                    setSettingsForm((prev) => ({
                      ...prev,
                      transferable: event.target.checked,
                    }))
                  }
                />
                <span>{t("detail.lbl_transferable")}</span>
              </label>

              <label className="switch">
                <input
                  type="checkbox"
                  checked={settingsForm.paused}
                  onChange={(event) =>
                    setSettingsForm((prev) => ({
                      ...prev,
                      paused: event.target.checked,
                    }))
                  }
                />
                <span>{t("detail.lbl_paused")}</span>
              </label>

              <div className="full form-actions">
                <button className="btn btn-secondary" type="submit" disabled={working}>
                  {working ? t("detail.submitting") : t("detail.btn_update_col")}
                </button>
              </div>
            </form>
          </article>

          <article className="panel">
            <div className="panel-header" style={{ borderBottom: 'none', paddingBottom: 0 }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <UserPlus size={18} /> {t("detail.operator")}
              </h3>
              <span className="hint">{t("detail.operator_hint")}</span>
            </div>
            <form className="form-grid" onSubmit={updateCollectionOperator}>
              {isRustDialect ? (
                <>
                  <label>
                    {t("detail.lbl_creator_ref")}
                    <input
                      required
                      type="number"
                      value={operatorForm.creatorRef}
                      onChange={(event) =>
                        setOperatorForm((prev) => ({
                          ...prev,
                          creatorRef: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    {t("detail.lbl_operator_ref")}
                    <input
                      required
                      type="number"
                      value={operatorForm.operatorRef}
                      onChange={(event) =>
                        setOperatorForm((prev) => ({
                          ...prev,
                          operatorRef: event.target.value,
                          operator: event.target.value,
                        }))
                      }
                    />
                  </label>
                </>
              ) : (
                <label className="full">
                  {t("detail.lbl_operator_addr")}
                  <input
                    required
                    value={operatorForm.operator}
                    onChange={(event) =>
                      setOperatorForm((prev) => ({
                        ...prev,
                        operator: event.target.value,
                      }))
                    }
                    placeholder={t("detail.ph_neo_address")}
                  />
                </label>
              )}

              <label className="switch full">
                <input
                  type="checkbox"
                  checked={operatorForm.enabled}
                  onChange={(event) =>
                    setOperatorForm((prev) => ({
                      ...prev,
                      enabled: event.target.checked,
                    }))
                  }
                />
                <span>{t("detail.lbl_operator_enabled")}</span>
              </label>

              <div className="full form-actions">
                <button className="btn btn-secondary" type="submit" disabled={working}>
                  {working ? t("detail.submitting") : t("detail.btn_update_op")}
                </button>
              </div>
            </form>
          </article>

          <article className="panel">
            <div className="panel-header" style={{ borderBottom: 'none', paddingBottom: 0 }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Sparkles size={18} /> {t("detail.mint_title")}
              </h3>
              <span className="hint">{t("detail.mint_hint")}</span>
            </div>

            <form className="form-grid" onSubmit={mintToken}>
              {isRustDialect ? (
                <>
                  <label>
                    {t("detail.lbl_operator_ref")}
                    <input
                      required
                      type="number"
                      value={mintForm.operatorRef}
                      onChange={(event) => setMintForm((prev) => ({ ...prev, operatorRef: event.target.value }))}
                    />
                  </label>
                  <label>
                    {t("detail.lbl_recipient_ref")}
                    <input
                      required
                      type="number"
                      value={mintForm.toRef}
                      onChange={(event) => setMintForm((prev) => ({ ...prev, toRef: event.target.value }))}
                    />
                  </label>
                  <label>
                    {t("detail.lbl_token_uri_ref")}
                    <input
                      required
                      type="number"
                      value={mintForm.tokenUriRef}
                      onChange={(event) => setMintForm((prev) => ({ ...prev, tokenUriRef: event.target.value }))}
                    />
                  </label>
                  <label>
                    {t("detail.lbl_properties_ref")}
                    <input
                      required
                      type="number"
                      value={mintForm.propertiesRef}
                      onChange={(event) => setMintForm((prev) => ({ ...prev, propertiesRef: event.target.value }))}
                    />
                  </label>
                  <label className="full">
                    {t("detail.lbl_transfer_data_ref")}
                    <input
                      type="number"
                      value={mintForm.transferDataRef}
                      onChange={(event) => setMintForm((prev) => ({ ...prev, transferDataRef: event.target.value }))}
                    />
                  </label>
                  <label className="full">
                    {t("detail.lbl_burn_operator_ref")}
                    <input
                      type="number"
                      value={mintForm.burnOperatorRef}
                      onChange={(event) => setMintForm((prev) => ({ ...prev, burnOperatorRef: event.target.value }))}
                    />
                  </label>
                </>
              ) : (
                <>
                  <label>
                    {t("detail.lbl_recipient")}
                    <input
                      required
                      value={mintForm.to}
                      onChange={(event) => setMintForm((prev) => ({ ...prev, to: event.target.value }))}
                      placeholder={t("detail.ph_neo_address")}
                    />
                  </label>

                  <label className="full">
                    {t("detail.lbl_token_uri")} ({t("detail.optional")})
                    <input
                      value={mintForm.tokenUri}
                      onChange={(event) => setMintForm((prev) => ({ ...prev, tokenUri: event.target.value }))}
                      placeholder={t("detail.ph_token_uri")}
                    />
                  </label>

                  <label className="full">
                    {t("detail.lbl_props_json")} ({t("detail.optional")})
                    <textarea
                      rows={5}
                      value={mintForm.propertiesJson}
                      onChange={(event) => setMintForm((prev) => ({ ...prev, propertiesJson: event.target.value }))}
                    />
                  </label>
                </>
              )}

              <div className="full form-actions">
                <button className="btn" type="submit" disabled={working}>
                  {working ? t("detail.submitting") : t("detail.btn_mint")}
                </button>
                {isCsharpDialect && (
                  <button className="btn btn-secondary" type="button" disabled={working || !hasDedicatedContract} onClick={() => {
                    const raw = window.prompt(t("detail.prompt_batch_size"), "10");
                    if (raw === null) {
                      return;
                    }
                    const amount = Number.parseInt(raw.trim(), 10);
                    if (!Number.isFinite(amount) || amount <= 0) {
                      setError(t("detail.err_batch_amount_invalid"));
                      return;
                    }
                    batchMint(amount);
                  }}>
                    {t("detail.btn_batch_mint")}
                  </button>
                )}
              </div>
            </form>
          </article>

          <article className="panel">
            <div className="panel-header" style={{ borderBottom: "none", paddingBottom: 0 }}>
              <h3 style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <Rocket size={18} /> {t("detail.drop_owner_title")}
              </h3>
              <span className="hint">{t("detail.drop_owner_hint")}</span>
            </div>

            <form className="form-grid" onSubmit={configureDrop}>
              <label className="switch full">
                <input
                  type="checkbox"
                  checked={dropConfigForm.enabled}
                  onChange={(event) =>
                    setDropConfigForm((prev) => ({
                      ...prev,
                      enabled: event.target.checked,
                    }))
                  }
                />
                <span>{t("detail.drop_enabled")}</span>
              </label>

              <label>
                {t("detail.drop_start_at")}
                <input
                  type="number"
                  min={0}
                  value={dropConfigForm.startAt}
                  onChange={(event) =>
                    setDropConfigForm((prev) => ({
                      ...prev,
                      startAt: event.target.value,
                    }))
                  }
                />
              </label>

              <label>
                {t("detail.drop_end_at")}
                <input
                  type="number"
                  min={0}
                  value={dropConfigForm.endAt}
                  onChange={(event) =>
                    setDropConfigForm((prev) => ({
                      ...prev,
                      endAt: event.target.value,
                    }))
                  }
                />
              </label>

              <label>
                {t("detail.drop_per_wallet_limit")}
                <input
                  type="number"
                  min={0}
                  value={dropConfigForm.perWalletLimit}
                  onChange={(event) =>
                    setDropConfigForm((prev) => ({
                      ...prev,
                      perWalletLimit: event.target.value,
                    }))
                  }
                />
              </label>

              <label className="switch">
                <input
                  type="checkbox"
                  checked={dropConfigForm.whitelistRequired}
                  onChange={(event) =>
                    setDropConfigForm((prev) => ({
                      ...prev,
                      whitelistRequired: event.target.checked,
                    }))
                  }
                />
                <span>{t("detail.drop_whitelist_required")}</span>
              </label>

              <div className="full form-actions">
                <button className="btn btn-secondary" type="submit" disabled={working}>
                  {working ? t("detail.submitting") : t("detail.btn_drop_configure")}
                </button>
              </div>
            </form>

            <form className="form-grid" onSubmit={updateDropWhitelist}>
              <label className="full">
                {t("detail.drop_whitelist_input")}
                <textarea
                  rows={4}
                  value={dropWhitelistInput}
                  onChange={(event) => setDropWhitelistInput(event.target.value)}
                  placeholder={t("detail.ph_drop_whitelist")}
                />
              </label>

              <div className="full form-actions">
                <button className="btn btn-secondary" type="submit" disabled={working}>
                  {working ? t("detail.submitting") : t("detail.btn_drop_whitelist")}
                </button>
              </div>
            </form>
          </article>

          <article className="panel">
            <div className="panel-header" style={{ borderBottom: "none", paddingBottom: 0 }}>
              <h3 style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <CalendarCheck size={18} /> {t("detail.check_in_owner_title")}
              </h3>
              <span className="hint">{t("detail.check_in_owner_hint")}</span>
            </div>

            <form className="form-grid" onSubmit={configureCheckInProgram}>
              <label className="switch full">
                <input
                  type="checkbox"
                  checked={checkInProgramForm.enabled}
                  onChange={(event) =>
                    setCheckInProgramForm((prev) => ({
                      ...prev,
                      enabled: event.target.checked,
                    }))
                  }
                />
                <span>{t("detail.check_in_enabled")}</span>
              </label>

              <label className="switch">
                <input
                  type="checkbox"
                  checked={checkInProgramForm.membershipRequired}
                  onChange={(event) =>
                    setCheckInProgramForm((prev) => ({
                      ...prev,
                      membershipRequired: event.target.checked,
                    }))
                  }
                />
                <span>{t("detail.check_in_membership_required")}</span>
              </label>

              <label className="switch">
                <input
                  type="checkbox"
                  checked={checkInProgramForm.membershipSoulbound}
                  onChange={(event) =>
                    setCheckInProgramForm((prev) => ({
                      ...prev,
                      membershipSoulbound: event.target.checked,
                    }))
                  }
                />
                <span>{t("detail.check_in_membership_soulbound")}</span>
              </label>

              <label>
                {t("detail.check_in_start_at")}
                <input
                  type="number"
                  min={0}
                  value={checkInProgramForm.startAt}
                  onChange={(event) =>
                    setCheckInProgramForm((prev) => ({
                      ...prev,
                      startAt: event.target.value,
                    }))
                  }
                />
              </label>

              <label>
                {t("detail.check_in_end_at")}
                <input
                  type="number"
                  min={0}
                  value={checkInProgramForm.endAt}
                  onChange={(event) =>
                    setCheckInProgramForm((prev) => ({
                      ...prev,
                      endAt: event.target.value,
                    }))
                  }
                />
              </label>

              <label>
                {t("detail.check_in_interval")}
                <input
                  type="number"
                  min={0}
                  value={checkInProgramForm.intervalSeconds}
                  onChange={(event) =>
                    setCheckInProgramForm((prev) => ({
                      ...prev,
                      intervalSeconds: event.target.value,
                    }))
                  }
                />
              </label>

              <label>
                {t("detail.check_in_max_per_wallet")}
                <input
                  type="number"
                  min={0}
                  value={checkInProgramForm.maxCheckInsPerWallet}
                  onChange={(event) =>
                    setCheckInProgramForm((prev) => ({
                      ...prev,
                      maxCheckInsPerWallet: event.target.value,
                    }))
                  }
                />
              </label>

              <label className="switch">
                <input
                  type="checkbox"
                  checked={checkInProgramForm.mintProofNft}
                  onChange={(event) =>
                    setCheckInProgramForm((prev) => ({
                      ...prev,
                      mintProofNft: event.target.checked,
                    }))
                  }
                />
                <span>{t("detail.check_in_mint_proof")}</span>
              </label>

              <div className="full form-actions">
                <button className="btn btn-secondary" type="submit" disabled={working}>
                  {working ? t("detail.submitting") : t("detail.btn_check_in_program")}
                </button>
              </div>
            </form>
          </article>

          {isCsharpDialect ? (
            <article className="panel">
              <div className="panel-header" style={{ borderBottom: 'none', paddingBottom: 0 }}>
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Rocket size={18} /> {t("detail.deploy_tpl")}
                </h3>
                <span className="hint">{t("detail.deploy_tpl_hint")}</span>
              </div>

              <p className="hint">{t("detail.lbl_tpl_configured")}: {templateConfigured ? t("detail.yes") : t("detail.no")}</p>
              <p className="hint">{t("detail.lbl_curr_contract")}: {deployedCollectionContractHash || t("detail.not_deployed")}</p>
                <p className="hint">
                  {t("detail.lbl_active_contract")}:{" "}
                  {hasDedicatedContract ? deployedCollectionContractHash : runtimeNetwork.contractHash || t("detail.not_configured")}
                </p>

              <form className="form-grid" onSubmit={deployCollectionContractFromTemplate}>
                <label className="full">
                  {t("detail.lbl_extra_data")}
                  <textarea
                    rows={4}
                    value={templateDeployData}
                    onChange={(event) => setTemplateDeployData(event.target.value)}
                    placeholder={t("detail.ph_extra_data_json")}
                  />
                </label>

                <div className="full form-actions">
                  <button className="btn btn-secondary" type="submit" disabled={working || !templateConfigured || hasDedicatedContract}>
                    {working ? t("detail.submitting") : t("detail.btn_deploy")}
                  </button>
                </div>
              </form>
            </article>
          ) : null}
        </>
      ) : null}

      <article className="panel">
        <div className="panel-header" style={{ borderBottom: "none", paddingBottom: 0 }}>
          <h3 style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Sparkles size={18} /> {t("detail.drop_claim_title")}
          </h3>
          <span className="hint">{t("detail.drop_claim_hint")}</span>
        </div>
        <p className="hint">
          {t("detail.drop_enabled")}: {dropConfigForm.enabled ? t("detail.yes") : t("detail.no")} | {t("detail.drop_start_at")}: {dropConfigForm.startAt} | {t("detail.drop_end_at")}: {dropConfigForm.endAt} | {t("detail.drop_per_wallet_limit")}: {dropConfigForm.perWalletLimit}
        </p>
        {dropWalletStats ? (
          <p className="hint">
            {t("detail.drop_stats_claimed")}: {dropWalletStats.claimed} | {t("detail.drop_stats_remaining")}: {formatDropRemaining(dropWalletStats.remaining)}
            {dropConfigForm.whitelistRequired ? ` | ${t("detail.drop_stats_allowance")}: ${dropWalletStats.whitelistAllowance}` : ""}
          </p>
        ) : null}
        {!supportsWalletLevelStats ? (
          <p className="hint">{t("detail.wallet_stats_not_supported")}</p>
        ) : null}

        <form className="form-grid" onSubmit={claimDrop}>
          {isRustDialect ? (
            <>
              <label>
                {t("detail.drop_claim_uri_ref")}
                <input
                  type="number"
                  value={dropClaimTokenUri}
                  onChange={(event) => setDropClaimTokenUri(event.target.value)}
                  placeholder="2001"
                />
              </label>
              <label>
                {t("detail.drop_claim_properties_ref")}
                <input
                  type="number"
                  value={dropClaimPropertiesJson}
                  onChange={(event) => setDropClaimPropertiesJson(event.target.value)}
                  placeholder="2002"
                />
              </label>
            </>
          ) : (
            <>
              <label className="full">
                {t("detail.lbl_token_uri")} ({t("detail.optional")})
                <input
                  value={dropClaimTokenUri}
                  onChange={(event) => setDropClaimTokenUri(event.target.value)}
                  placeholder={t("detail.ph_token_uri")}
                />
              </label>
              <label className="full">
                {t("detail.lbl_props_json")} ({t("detail.optional")})
                <textarea
                  rows={4}
                  value={dropClaimPropertiesJson}
                  onChange={(event) => setDropClaimPropertiesJson(event.target.value)}
                />
              </label>
            </>
          )}

          <div className="full form-actions">
            <button className="btn" type="submit" disabled={working || !wallet.address}>
              {working ? t("detail.submitting") : t("detail.btn_drop_claim")}
            </button>
            {dropWalletStats && !dropWalletStats.claimableNow ? (
              <span className="hint">{t("detail.drop_not_claimable")}</span>
            ) : null}
          </div>
        </form>
      </article>

      <article className="panel">
        <div className="panel-header" style={{ borderBottom: "none", paddingBottom: 0 }}>
          <h3 style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <CalendarCheck size={18} /> {t("detail.check_in_user_title")}
          </h3>
          <span className="hint">{t("detail.check_in_user_hint")}</span>
        </div>
        <p className="hint">
          {t("detail.check_in_enabled")}: {checkInProgramForm.enabled ? t("detail.yes") : t("detail.no")} | {t("detail.check_in_membership_required")}: {checkInProgramForm.membershipRequired ? t("detail.yes") : t("detail.no")} | {t("detail.check_in_interval")}: {checkInProgramForm.intervalSeconds}
        </p>
        {membershipStatus ? (
          <p className="hint">
            {t("detail.membership_balance")}: {membershipStatus.membershipBalance} | {t("detail.membership_is_member")}: {membershipStatus.isMember ? t("detail.yes") : t("detail.no")} | {t("detail.check_in_membership_soulbound")}: {membershipStatus.membershipSoulbound ? t("detail.yes") : t("detail.no")}
          </p>
        ) : null}
        {checkInWalletStats ? (
          <p className="hint">
            {t("detail.check_in_count")}: {checkInWalletStats.checkInCount} | {t("detail.check_in_remaining")}: {formatDropRemaining(checkInWalletStats.remainingCheckIns)}
          </p>
        ) : null}
        {!supportsWalletLevelStats ? (
          <p className="hint">{t("detail.wallet_stats_not_supported")}</p>
        ) : null}

        <form className="form-grid" onSubmit={submitCheckIn}>
          {isRustDialect ? (
            <>
              <label>
                {t("detail.check_in_uri_ref")}
                <input
                  type="number"
                  value={checkInTokenUri}
                  onChange={(event) => setCheckInTokenUri(event.target.value)}
                  placeholder="2001"
                />
              </label>
              <label>
                {t("detail.check_in_properties_ref")}
                <input
                  type="number"
                  value={checkInPropertiesJson}
                  onChange={(event) => setCheckInPropertiesJson(event.target.value)}
                  placeholder="2002"
                />
              </label>
            </>
          ) : (
            <>
              <label className="full">
                {t("detail.lbl_token_uri")} ({t("detail.optional")})
                <input
                  value={checkInTokenUri}
                  onChange={(event) => setCheckInTokenUri(event.target.value)}
                  placeholder={t("detail.ph_token_uri")}
                />
              </label>
              <label className="full">
                {t("detail.lbl_props_json")} ({t("detail.optional")})
                <textarea
                  rows={4}
                  value={checkInPropertiesJson}
                  onChange={(event) => setCheckInPropertiesJson(event.target.value)}
                />
              </label>
            </>
          )}

          <div className="full form-actions">
            <button className="btn" type="submit" disabled={working || !wallet.address || (checkInWalletStats ? !checkInWalletStats.checkInNow : false)}>
              {working ? t("detail.submitting") : t("detail.btn_check_in")}
            </button>
            {checkInWalletStats && !checkInWalletStats.checkInNow ? (
              <span className="hint">{t("detail.check_in_not_available")}</span>
            ) : null}
          </div>
        </form>
      </article>

      <article className="panel">
        <div className="panel-header" style={{ borderBottom: 'none', paddingBottom: 0 }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <FolderOpen size={18} /> {t("detail.inventory")}
          </h3>
          <span className="hint">{tokens.length} {t("detail.inventory_hint")}</span>
        </div>

        {tokens.length === 0 ? (
          <p className="hint">{t("detail.no_token")}</p>
        ) : (
          <div className="stack-md">
            {tokens.map((token) => (
              <div className="token-card" key={token.tokenId}>
                <div>
                  <p className="mini-card-title">{token.tokenId}</p>
                  <p className="hint">{t("detail.lbl_owner")}: {token.owner}</p>
                  <a
                    href={isNeoFsUri(token.uri) ? getNeoFsResourceProxyUrl(token.uri) : resolvedTokenUriById[token.tokenId] ?? token.uri}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-link"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}
                  >
                    {t("detail.meta_uri")} <ArrowUpRight size={14} />
                  </a>
                  {resolvedTokenUriById[token.tokenId] && resolvedTokenUriById[token.tokenId] !== token.uri ? (
                    <p className="hint">
                      {t("detail.resolved_neofs")}: {token.uri}
                      <br />
                      <a href={resolvedTokenUriById[token.tokenId]} target="_blank" rel="noreferrer" className="inline-link" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                        {t("detail.open_gateway")} <ArrowUpRight size={14} />
                      </a>
                    </p>
                  ) : null}
                  {isNeoFsUri(token.uri) && neoFsMeta?.enabled ? (
                    <button
                      className="btn btn-secondary"
                      type="button"
                      disabled={metadataLoadingTokenId === token.tokenId}
                      onClick={() => void loadTokenMetadata(token)}
                    >
                      {metadataLoadingTokenId === token.tokenId ? t("detail.btn_loading_neofs") : t("detail.btn_load_neofs")}
                    </button>
                  ) : null}
                  {mediaUriByTokenId[token.tokenId] ? (
                    <img
                      className="metadata-media"
                      src={mediaUriByTokenId[token.tokenId]}
                      alt={`Token media ${token.tokenId}`}
                      loading="lazy"
                    />
                  ) : null}
                  {metadataByTokenId[token.tokenId] ? (
                    <pre className="metadata-preview">{metadataByTokenId[token.tokenId]}</pre>
                  ) : null}
                  {ghostMarket?.enabled ? (
                    <a
                      href={fillGhostMarketTemplate(ghostMarket.tokenUrlTemplate, {
                        contractHash: hasDedicatedContract ? deployedCollectionContractHash : ghostMarket.contractHash,
                        collectionId,
                        tokenId: token.tokenId,
                      })}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-link"
                    >
                      {t("detail.open_ghost_token")}
                    </a>
                  ) : null}
                </div>

                <div className="token-actions">
                  <input
                    placeholder={isRustDialect ? t("detail.ph_recipient_ref") : t("detail.ph_recipient_address")}
                    value={recipientByToken[token.tokenId] ?? ""}
                    onChange={(event) =>
                      setRecipientByToken((prev) => ({
                        ...prev,
                        [token.tokenId]: event.target.value,
                      }))
                    }
                  />
                  <button
                    className="btn btn-secondary"
                    type="button"
                    disabled={working}
                    onClick={() => void transferToken(token.tokenId)}
                  >
                    {t("detail.btn_transfer")}
                  </button>
                  <button className="btn btn-danger" type="button" disabled={working} onClick={() => void burnToken(token.tokenId)}>
                    {t("detail.btn_burn")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </article>

      {message ? <p className="success">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}
