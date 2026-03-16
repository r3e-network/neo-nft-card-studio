import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { wallet as neonWallet } from "@cityofzion/neon-js";
import type { WalletInvokeRequest } from "@platform/neo-sdk";

import {
  clearStoredNeoProviderHint,
  connectNeoWallet,
  getNeoProvider,
  getNeoWalletAccount,
  getNeoWalletNetwork,
  getNeoWalletNetworkForAddress,
  invokeNeoWallet,
  type NeoWalletNetwork,
} from "../lib/neoline";
import { APP_CONFIG } from "../lib/config";
import { setRuntimeSelectedFrontendNetwork, setRuntimeWalletNetwork } from "../lib/runtime-network";
import { resolveWalletSessionSnapshot } from "../lib/wallet-session";
import { getWifAccount, invokeNeoWalletWithWif } from "../lib/wifWallet";

interface WalletState {
  address: string | null;
  network: NeoWalletNetwork | null;
  isReady: boolean;
  isConnecting: boolean;
  connect: () => Promise<void>;
  connectWif: (wif: string) => Promise<void>;
  disconnect: () => void;
  sync: () => Promise<void>;
  invoke: (payload: WalletInvokeRequest) => Promise<string>;
}

const WalletContext = createContext<WalletState | null>(null);
const WALLET_CONNECTED_KEY = "opennft_wallet_connected";
const DEV_WIF_KEY = "opennft_wallet_wif";
const WALLET_ADDRESS_KEY = "opennft_wallet_address";
const WALLET_NETWORK_KEY = "opennft_wallet_network";

function isSameWalletNetwork(a: NeoWalletNetwork | null, b: NeoWalletNetwork | null): boolean {
  if (!a && !b) {
    return true;
  }

  if (!a || !b) {
    return false;
  }

  return a.network === b.network && a.magic === b.magic && (a.rpcUrl ?? "") === (b.rpcUrl ?? "");
}

function isSameWalletAddress(a: string | null, b: string | null): boolean {
  return (a ?? "").trim() === (b ?? "").trim();
}

function syncSelectedFrontendNetwork(nextNetwork: NeoWalletNetwork | null): void {
  if (!nextNetwork || nextNetwork.network === "unknown") {
    return;
  }

  setRuntimeSelectedFrontendNetwork(nextNetwork.network);
}

function buildDefaultWalletSigners(address: string): Array<{ account: string; scopes: string }> {
  return [
    {
      account: neonWallet.getScriptHashFromAddress(address),
      scopes: "CalledByEntry",
    },
  ];
}

function extractWalletAddressFromEvent(data: unknown): string | null {
  const tryValue = (value: unknown): string | null => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        const found = tryValue(entry);
        if (found) {
          return found;
        }
      }
      return null;
    }

    if (!value || typeof value !== "object") {
      return null;
    }

    const record = value as Record<string, unknown>;
    for (const key of ["address", "accAddress", "walletAddress"]) {
      const found = tryValue(record[key]);
      if (found) {
        return found;
      }
    }

    for (const key of ["detail", "data", "account", "result"]) {
      const found = tryValue(record[key]);
      if (found) {
        return found;
      }
    }

    return null;
  };

  return tryValue(data);
}

function readStoredWalletAddress(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const value = localStorage.getItem(WALLET_ADDRESS_KEY)?.trim();
  return value ? value : null;
}

function readStoredWalletNetwork(): NeoWalletNetwork | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = localStorage.getItem(WALLET_NETWORK_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as NeoWalletNetwork;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    if (
      parsed.network !== "mainnet" &&
      parsed.network !== "testnet" &&
      parsed.network !== "private" &&
      parsed.network !== "unknown"
    ) {
      return null;
    }

    return {
      network: parsed.network,
      magic: typeof parsed.magic === "number" ? parsed.magic : null,
      rpcUrl: typeof parsed.rpcUrl === "string" ? parsed.rpcUrl : undefined,
      raw: parsed.raw ?? null,
    };
  } catch {
    return null;
  }
}

function isWalletAccessDeniedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.trim().toLowerCase() : "";
  if (!message) {
    return false;
  }

  return (
    message.includes("wallet access was denied")
    || message.includes("wallet request was cancelled")
    || message.includes("wallet network does not match")
    || message.includes("connection denied")
  );
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(() => readStoredWalletAddress());
  const [network, setNetwork] = useState<NeoWalletNetwork | null>(() => readStoredWalletNetwork());
  const [isConnecting, setIsConnecting] = useState(false);
  const [isReady, setIsReady] = useState<boolean>(() => Boolean(getNeoProvider()));
  const suppressSilentSyncUntilRef = useRef(0);

  const clearWalletSession = useCallback((preserveDevWif = true) => {
    localStorage.removeItem(WALLET_CONNECTED_KEY);
    localStorage.removeItem(WALLET_ADDRESS_KEY);
    localStorage.removeItem(WALLET_NETWORK_KEY);
    clearStoredNeoProviderHint();
    if (!preserveDevWif) {
      localStorage.removeItem(DEV_WIF_KEY);
    }
    setAddress(null);
    setNetwork(null);
    setRuntimeWalletNetwork(null);
  }, []);

  const syncWalletSession = useCallback(async (silent = true): Promise<{
    address: string | null;
    network: NeoWalletNetwork | null;
  }> => {
    const isConnected = localStorage.getItem(WALLET_CONNECTED_KEY) === "true";
    const devWif = import.meta.env.DEV ? localStorage.getItem(DEV_WIF_KEY) : null;

    if (!isConnected && silent) {
      clearWalletSession(Boolean(devWif));
      return { address: null, network: null };
    }

    try {
      if (devWif) {
        const account = getWifAccount(devWif);
        if (account) {
          const nextAddress = account.address;
          const nextNetwork: NeoWalletNetwork = {
            network: "testnet",
            magic: 894710606,
            rpcUrl: APP_CONFIG.networks.testnet.rpcUrl ?? APP_CONFIG.rpcUrl,
            raw: null,
          };
          localStorage.setItem(WALLET_CONNECTED_KEY, "true");
          localStorage.setItem(WALLET_ADDRESS_KEY, nextAddress);
          localStorage.setItem(WALLET_NETWORK_KEY, JSON.stringify(nextNetwork));
          setAddress((prev) => (isSameWalletAddress(prev, nextAddress) ? prev : nextAddress));
          setNetwork((prev) => (isSameWalletNetwork(prev, nextNetwork) ? prev : nextNetwork));
          setRuntimeWalletNetwork(nextNetwork);
          syncSelectedFrontendNetwork(nextNetwork);
          return { address: nextAddress, network: nextNetwork };
        }
      }

      const fallbackAddress = address?.trim() || readStoredWalletAddress();
      const fallbackNetwork = network ?? readStoredWalletNetwork();
      const currentAccount = await getNeoWalletAccount(silent);
      const providerAddress = currentAccount?.address?.trim() || null;
      // Resolve network after account so the matching provider is preferred.
      const currentNetwork = await getNeoWalletNetworkForAddress(providerAddress || fallbackAddress, silent);
      const session = resolveWalletSessionSnapshot({
        silent,
        fallbackAddress,
        fallbackNetwork,
        providerAddress,
        providerNetwork: currentNetwork,
      });
      const nextAddress = session.address;
      const nextNetwork = session.network;

      if (nextAddress) {
        localStorage.setItem(WALLET_CONNECTED_KEY, "true");
        localStorage.setItem(WALLET_ADDRESS_KEY, nextAddress);
        if (nextNetwork) {
          localStorage.setItem(WALLET_NETWORK_KEY, JSON.stringify(nextNetwork));
        }
      } else {
        localStorage.removeItem(WALLET_CONNECTED_KEY);
        localStorage.removeItem(WALLET_ADDRESS_KEY);
        localStorage.removeItem(WALLET_NETWORK_KEY);
      }

      setAddress((prev) => (isSameWalletAddress(prev, nextAddress) ? prev : nextAddress));
      setNetwork((prev) => (isSameWalletNetwork(prev, nextNetwork) ? prev : nextNetwork));
      setRuntimeWalletNetwork(nextNetwork);
      syncSelectedFrontendNetwork(nextNetwork);

      return {
        address: nextAddress,
        network: nextNetwork,
      };
    } catch (err) {
      if (!silent) console.error("Sync failed:", err);
      if (silent && address) {
        return { address, network };
      }
      clearWalletSession(Boolean(devWif));
      return { address: null, network: null };
    }
  }, [address, clearWalletSession, network]);

  // 1. Initial Readiness & Events Setup
  useEffect(() => {
    const setupEvents = (provider: any) => {
      if (!provider) return;

      const onAccountChanged = (data: any) => {
        const addr = extractWalletAddressFromEvent(data);
        setAddress(addr);
        if (!addr) {
          void syncWalletSession(true);
          return;
        }

        suppressSilentSyncUntilRef.current = Date.now() + 5000;
        localStorage.setItem(WALLET_CONNECTED_KEY, "true");
        localStorage.setItem(WALLET_ADDRESS_KEY, addr);
        void getNeoWalletNetwork(true).then((nextNetwork) => {
          localStorage.setItem(WALLET_NETWORK_KEY, JSON.stringify(nextNetwork));
          setNetwork((prev) => (isSameWalletNetwork(prev, nextNetwork) ? prev : nextNetwork));
          setRuntimeWalletNetwork(nextNetwork);
          syncSelectedFrontendNetwork(nextNetwork);
        });
      };

      const onNetworkChanged = () => {
        void getNeoWalletNetwork(true).then((nextNetwork) => {
          setNetwork((prev) => (isSameWalletNetwork(prev, nextNetwork) ? prev : nextNetwork));
          setRuntimeWalletNetwork(nextNetwork);
          syncSelectedFrontendNetwork(nextNetwork);
        });
      };

      if (provider.addEventListener && provider.EVENT) {
        provider.addEventListener(provider.EVENT.ACCOUNT_CHANGED, onAccountChanged);
        provider.addEventListener(provider.EVENT.NETWORK_CHANGED, onNetworkChanged);
        return () => {
          provider.removeEventListener?.(provider.EVENT.ACCOUNT_CHANGED, onAccountChanged);
          provider.removeEventListener?.(provider.EVENT.NETWORK_CHANGED, onNetworkChanged);
        };
      }
    };

    if (isReady) {
      return setupEvents(getNeoProvider());
    }

    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      const provider = getNeoProvider();
      if (provider) {
        setIsReady(true);
        clearInterval(interval);
      } else if (attempts > 20) {
        clearInterval(interval);
      }
    }, 500);

    return () => clearInterval(interval);
  }, [clearWalletSession, isReady, syncWalletSession]);

  // 2. Initial Session Restore
  useEffect(() => {
    if (!isReady) return;
    void syncWalletSession(true);
  }, [isReady, syncWalletSession]);

  // Keep the module-level runtime network aligned with React state so
  // cross-page actions and reloads continue to resolve the correct network.
  useEffect(() => {
    setRuntimeWalletNetwork(network);
  }, [network]);

  // 3. Focus Recovery (less frequent)
  useEffect(() => {
    if (!isReady) return;
    const onFocus = () => {
      if (Date.now() < suppressSilentSyncUntilRef.current) {
        return;
      }
      void syncWalletSession(true);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [isReady, syncWalletSession]);

  const value = useMemo<WalletState>(
    () => ({
      address,
      network,
      isReady,
      isConnecting,
      connect: async () => {
        setIsConnecting(true);
        try {
          const account = await connectNeoWallet();
          suppressSilentSyncUntilRef.current = Date.now() + 5000;
          localStorage.setItem(WALLET_CONNECTED_KEY, "true");
          const nextAddress = account.address?.trim() || null;
          if (!nextAddress) {
            throw new Error("Wallet connected but no address was returned.");
          }
          localStorage.setItem(WALLET_ADDRESS_KEY, nextAddress);

          setAddress((prev) => (isSameWalletAddress(prev, nextAddress) ? prev : nextAddress));

          void getNeoWalletNetwork(true)
            .then((currentNetwork) => {
              const nextNetwork = currentNetwork.network === "unknown" && currentNetwork.magic === null
                ? null
                : currentNetwork;

              if (nextNetwork) {
                localStorage.setItem(WALLET_NETWORK_KEY, JSON.stringify(nextNetwork));
              }
              setNetwork((prev) => (isSameWalletNetwork(prev, nextNetwork) ? prev : nextNetwork));
              setRuntimeWalletNetwork(nextNetwork);
              syncSelectedFrontendNetwork(nextNetwork);
            })
            .catch(() => {
              setNetwork((prev) => (prev === null ? prev : null));
              setRuntimeWalletNetwork(null);
            });
        } catch (err) {
          console.error("Connect failed:", err);
          clearWalletSession(true);
          throw err;
        } finally {
          setIsConnecting(false);
        }
      },
      connectWif: async (wif: string) => {
        setIsConnecting(true);
        try {
          const account = getWifAccount(wif);
          if (!account) throw new Error("Invalid WIF key");
          localStorage.setItem(DEV_WIF_KEY, wif);
          await syncWalletSession(false);
        } finally {
          setIsConnecting(false);
        }
      },
      disconnect: () => {
        clearWalletSession(false);
      },
      sync: async () => {
        let session = address
          ? await syncWalletSession(true)
          : await syncWalletSession(false);

        const devWif = import.meta.env.DEV ? localStorage.getItem(DEV_WIF_KEY) : null;
        if (!devWif && session.address) {
          const liveAccount = await getNeoWalletAccount(true);
          if (!liveAccount || !isSameWalletAddress(liveAccount.address, session.address)) {
            session = await syncWalletSession(false);
          }
        }

        if (!session.address) {
          throw new Error("Wallet session is unavailable. Please reconnect wallet.");
        }
      },
      invoke: async (payload: WalletInvokeRequest) => {
        const session = address
          ? await syncWalletSession(true)
          : await syncWalletSession(false);
        if (!session.address) {
          throw new Error("Wallet session is unavailable. Please reconnect wallet.");
        }

        const devWif = import.meta.env.DEV ? localStorage.getItem(DEV_WIF_KEY) : null;
        const invokePayload = devWif || (payload.signers && payload.signers.length > 0)
          ? payload
          : {
              ...payload,
              signers: buildDefaultWalletSigners(session.address),
            };
        let result;
        try {
          result = devWif
            ? await invokeNeoWalletWithWif(devWif, invokePayload)
            : await invokeNeoWallet(invokePayload);
        } catch (err) {
          if (isWalletAccessDeniedError(err)) {
            clearWalletSession(true);
          }
          throw err;
        }

        const rawTxId = (result.txid ?? result.transaction ?? result.txId ?? result.transactionId ?? "").toString().trim();
        if (!rawTxId) {
          throw new Error("Wallet invoke succeeded but no transaction id was returned. Please check wallet history.");
        }

        if (!/^(?:0x)?[0-9a-fA-F]{64}$/.test(rawTxId)) {
          throw new Error("Wallet returned an invalid transaction id format. Please check wallet history.");
        }

        return rawTxId.startsWith("0x") || rawTxId.startsWith("0X")
          ? `0x${rawTxId.slice(2)}`
          : `0x${rawTxId}`;
      },
    }),
    [address, clearWalletSession, network, isConnecting, isReady, syncWalletSession],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error("useWallet must be used inside WalletProvider");
  }
  return ctx;
}
