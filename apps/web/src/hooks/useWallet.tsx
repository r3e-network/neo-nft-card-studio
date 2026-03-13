import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import type { WalletInvokeRequest } from "@platform/neo-sdk";

import {
  connectNeoWallet,
  getNeoProvider,
  getNeoWalletAccount,
  getNeoWalletNetwork,
  invokeNeoWallet,
  type NeoWalletNetwork,
} from "../lib/neoline";
import { setRuntimeWalletNetwork } from "../lib/runtime-network";
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

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [network, setNetwork] = useState<NeoWalletNetwork | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isReady, setIsReady] = useState<boolean>(() => Boolean(getNeoProvider()));

  const clearWalletSession = useCallback((preserveDevWif = true) => {
    localStorage.removeItem(WALLET_CONNECTED_KEY);
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
          const nextNetwork: NeoWalletNetwork = { network: "testnet", magic: 894710606, rpcUrl: "https://n3seed1.ngd.network:20332", raw: null };
          localStorage.setItem(WALLET_CONNECTED_KEY, "true");
          setAddress((prev) => (isSameWalletAddress(prev, nextAddress) ? prev : nextAddress));
          setNetwork((prev) => (isSameWalletNetwork(prev, nextNetwork) ? prev : nextNetwork));
          setRuntimeWalletNetwork(nextNetwork);
          return { address: nextAddress, network: nextNetwork };
        }
      }

      // Single call to get network/account, prioritized by provider
      const currentNetwork = await getNeoWalletNetwork(silent);
      const currentAccount = await getNeoWalletAccount(silent);
      
      const nextAddress = currentAccount?.address?.trim() || null;
      const nextNetwork = nextAddress ? currentNetwork : null;

      if (nextAddress) {
        localStorage.setItem(WALLET_CONNECTED_KEY, "true");
      } else {
        localStorage.removeItem(WALLET_CONNECTED_KEY);
      }

      setAddress((prev) => (isSameWalletAddress(prev, nextAddress) ? prev : nextAddress));
      setNetwork((prev) => (isSameWalletNetwork(prev, nextNetwork) ? prev : nextNetwork));
      setRuntimeWalletNetwork(nextNetwork);

      return {
        address: nextAddress,
        network: nextNetwork,
      };
    } catch (err) {
      if (!silent) console.error("Sync failed:", err);
      clearWalletSession(Boolean(devWif));
      return { address: null, network: null };
    }
  }, [clearWalletSession]);

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

        localStorage.setItem(WALLET_CONNECTED_KEY, "true");
        void getNeoWalletNetwork(true).then((nextNetwork) => {
          setNetwork((prev) => (isSameWalletNetwork(prev, nextNetwork) ? prev : nextNetwork));
          setRuntimeWalletNetwork(nextNetwork);
        });
      };

      const onNetworkChanged = () => {
        void getNeoWalletNetwork(true).then((nextNetwork) => {
          setNetwork((prev) => (isSameWalletNetwork(prev, nextNetwork) ? prev : nextNetwork));
          setRuntimeWalletNetwork(nextNetwork);
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

  // 3. Focus Recovery (less frequent)
  useEffect(() => {
    if (!isReady) return;
    const onFocus = () => {
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
          localStorage.setItem(WALLET_CONNECTED_KEY, "true");
          const nextAddress = account.address?.trim() || null;
          if (!nextAddress) {
            throw new Error("Wallet connected but no address was returned.");
          }

          setAddress((prev) => (isSameWalletAddress(prev, nextAddress) ? prev : nextAddress));

          void getNeoWalletNetwork(true)
            .then((currentNetwork) => {
              const nextNetwork = currentNetwork.network === "unknown" && currentNetwork.magic === null
                ? null
                : currentNetwork;

              setNetwork((prev) => (isSameWalletNetwork(prev, nextNetwork) ? prev : nextNetwork));
              setRuntimeWalletNetwork(nextNetwork);
            })
            .catch(() => {
              setNetwork((prev) => (prev === null ? prev : null));
              setRuntimeWalletNetwork(null);
            });
        } catch (err) {
          console.error("Connect failed:", err);
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
        const session = await syncWalletSession(false);
        if (!session.address) {
          throw new Error("Wallet session is unavailable. Please reconnect wallet.");
        }
      },
      invoke: async (payload: WalletInvokeRequest) => {
        const session = await syncWalletSession(false);
        if (!session.address) {
          throw new Error("Wallet session is unavailable. Please reconnect wallet.");
        }

        const devWif = import.meta.env.DEV ? localStorage.getItem(DEV_WIF_KEY) : null;
        const result = devWif 
          ? await invokeNeoWalletWithWif(devWif, payload)
          : await invokeNeoWallet(payload);

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
