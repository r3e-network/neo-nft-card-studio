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

interface WalletState {
  address: string | null;
  network: NeoWalletNetwork | null;
  isReady: boolean;
  isConnecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  sync: () => Promise<void>;
  invoke: (payload: WalletInvokeRequest) => Promise<string>;
}

const WalletContext = createContext<WalletState | null>(null);
const WALLET_CONNECTED_KEY = "opennft_wallet_connected";

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

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [network, setNetwork] = useState<NeoWalletNetwork | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isReady, setIsReady] = useState<boolean>(() => Boolean(getNeoProvider()));

  const syncWalletSession = useCallback(async (silent = true): Promise<{
    address: string | null;
    network: NeoWalletNetwork | null;
  }> => {
    // Only proceed if isConnected flag is set or non-silent mode requested
    const isConnected = localStorage.getItem(WALLET_CONNECTED_KEY) === "true";
    if (!isConnected && silent) {
      return { address: null, network: null };
    }

    const [currentNetwork, currentAccount] = await Promise.all([
      getNeoWalletNetwork(silent),
      getNeoWalletAccount(silent)
    ]);
    
    const nextAddress = currentAccount?.address?.trim() || null;
    const nextNetwork = nextAddress ? currentNetwork : null;

    if (nextAddress) {
      localStorage.setItem(WALLET_CONNECTED_KEY, "true");
    }

    setAddress((prev) => (isSameWalletAddress(prev, nextAddress) ? prev : nextAddress));
    setNetwork((prev) => (isSameWalletNetwork(prev, nextNetwork) ? prev : nextNetwork));
    setRuntimeWalletNetwork(nextNetwork);

    return {
      address: nextAddress,
      network: nextNetwork,
    };
  }, []);

  useEffect(() => {
    if (isReady) return;

    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      if (getNeoProvider()) {
        setIsReady(true);
        clearInterval(interval);
      } else if (attempts > 20) { // Give up after 10s
        clearInterval(interval);
      }
    }, 500);

    return () => clearInterval(interval);
  }, [isReady]);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    let closed = false;

    const syncNetwork = async () => {
      try {
        if (closed) {
          return;
        }
        await syncWalletSession(true);
      } catch {
        // ignore transient provider/network read failures
      }
    };

    const interval = setInterval(() => {
      void syncNetwork();
    }, 3000);

    const onFocus = () => {
      void syncNetwork();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    void syncNetwork();

    return () => {
      closed = true;
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
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
          // If a wallet was injected late, ensure state catches up immediately when clicking too
          if (!isReady && getNeoProvider()) {
            setIsReady(true);
          }
          await connectNeoWallet();
          localStorage.setItem(WALLET_CONNECTED_KEY, "true");
          await syncWalletSession(false);
        } catch (err) {
          console.error("Connect failed:", err);
          throw err;
        } finally {
          setIsConnecting(false);
        }
      },
      disconnect: () => {
        localStorage.removeItem(WALLET_CONNECTED_KEY);
        setAddress(null);
        setNetwork(null);
        setRuntimeWalletNetwork(null);
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

        const result = await invokeNeoWallet(payload);
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
    [address, network, isConnecting, isReady, syncWalletSession],
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
