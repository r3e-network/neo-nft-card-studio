import type { TFunction } from "i18next";

const UNKNOWN_WALLET_NETWORK_MESSAGE = "Connected wallet network is unknown. Switch wallet to MainNet/TestNet and reconnect.";
const WALLET_SESSION_UNAVAILABLE_MESSAGE = "Wallet session is unavailable. Please reconnect wallet.";

function normalizeNetworkLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return "UNKNOWN";
  }
  return normalized.toUpperCase();
}

export function toUserErrorMessage(t: TFunction, error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : "";
  if (!message) {
    return t("app.generic_error");
  }

  if (message === UNKNOWN_WALLET_NETWORK_MESSAGE) {
    return t("app.err_wallet_network_unknown");
  }

  if (message === WALLET_SESSION_UNAVAILABLE_MESSAGE) {
    return t("app.err_wallet_session_unavailable");
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
