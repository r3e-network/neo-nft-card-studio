import type { TFunction } from "i18next";
import { getUploadTooLargeMessage } from "./upload-limits";

const UNKNOWN_WALLET_NETWORK_MESSAGE = "Connected wallet network is unknown. Switch wallet to MainNet/TestNet and reconnect.";
const WALLET_CONNECTION_DENIED_MESSAGE = "Wallet access was denied by NeoLine. Approve the NeoLine connection/account prompt and retry.";
const WALLET_SESSION_UNAVAILABLE_MESSAGE = "Wallet session is unavailable. Please reconnect wallet.";
const WALLET_TXID_MISSING_MESSAGE = "Wallet invoke succeeded but no transaction id was returned. Please check wallet history.";
const WALLET_TXID_INVALID_MESSAGE = "Wallet returned an invalid transaction id format. Please check wallet history.";

function normalizeNetworkLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return "UNKNOWN";
  }
  return normalized.toUpperCase();
}

function summarizeRequestPath(url: string): string {
  try {
    const parsed = new URL(url, "http://local");
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

export function toUserErrorMessage(t: TFunction, error: unknown): string {
  const errorRecord = typeof error === "object" && error !== null ? error as Record<string, unknown> : null;
  const response = typeof errorRecord?.response === "object" && errorRecord.response !== null
    ? errorRecord.response as Record<string, unknown>
    : null;
  const config = typeof errorRecord?.config === "object" && errorRecord.config !== null
    ? errorRecord.config as Record<string, unknown>
    : null;
  const responseStatus = typeof response?.status === "number" ? response.status : null;
  const requestUrl = typeof config?.url === "string" ? config.url : "";
  const message = error instanceof Error ? error.message.trim() : "";

  if (
    requestUrl.includes("/meta/neofs/upload")
    && responseStatus === 413
  ) {
    return getUploadTooLargeMessage();
  }

  if (requestUrl && responseStatus) {
    const path = summarizeRequestPath(requestUrl);

    if (requestUrl.includes("/meta/neofs/upload")) {
      return `NeoFS upload request failed (HTTP ${responseStatus}) at ${path}.`;
    }

    if (requestUrl.includes("/meta/contract")) {
      return `Contract metadata request failed (HTTP ${responseStatus}) at ${path}.`;
    }

    if (requestUrl.includes("/collections")) {
      return `Collection request failed (HTTP ${responseStatus}) at ${path}.`;
    }
  }

  if (!message) {
    return t("app.generic_error");
  }

  if (message === UNKNOWN_WALLET_NETWORK_MESSAGE) {
    return t("app.err_wallet_network_unknown");
  }

  if (message === WALLET_CONNECTION_DENIED_MESSAGE) {
    return t("app.err_wallet_connection_denied");
  }

  if (message === WALLET_SESSION_UNAVAILABLE_MESSAGE) {
    return t("app.err_wallet_session_unavailable");
  }

  if (message === WALLET_TXID_MISSING_MESSAGE) {
    return t("app.err_wallet_txid_missing");
  }

  if (message === WALLET_TXID_INVALID_MESSAGE) {
    return t("app.err_wallet_txid_invalid");
  }

  const contractHashMatch = message.match(
    /^NFT platform contract hash is not configured for wallet network '([^']+)'\. Set (VITE_[A-Z0-9_]+)\.$/i,
  );
  if (contractHashMatch) {
    return t("app.contract_hash_missing", {
      network: normalizeNetworkLabel(contractHashMatch[1]),
      env: contractHashMatch[2],
    });
  }

  const invalidContractHashMatch = message.match(
    /^NFT platform contract hash is invalid for wallet network '([^']+)'\. Check (VITE_[A-Z0-9_]+)\.$/i,
  );
  if (invalidContractHashMatch) {
    return t("app.contract_hash_invalid", {
      network: normalizeNetworkLabel(invalidContractHashMatch[1]),
      env: invalidContractHashMatch[2],
    });
  }

  const rpcUrlMatch = message.match(
    /^NFT platform RPC URL is not configured for wallet network '([^']+)'\. Set (VITE_[A-Z0-9_]+)\.$/i,
  );
  if (rpcUrlMatch) {
    return t("app.rpc_url_missing", {
      network: normalizeNetworkLabel(rpcUrlMatch[1]),
      env: rpcUrlMatch[2],
    });
  }

  if (/^No Neo N3 wallet found/i.test(message)) {
    return t("app.install_wallet_required");
  }

  if (message.startsWith("Invalid contract hash format")) {
    return t("app.contract_hash_invalid_generic");
  }

  if (/VITE_[A-Z0-9_]+/.test(message) || /(?:\bNEO_|\bINDEXER_)/.test(message)) {
    return t("app.generic_error");
  }

  return message;
}
