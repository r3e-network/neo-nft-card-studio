import { createContext, useContext, useEffect, useMemo, useState } from "react";

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
  invoke: (payload: WalletInvokeRequest) => Promise<string>;
}

const WalletContext = createContext<WalletState | null>(null);

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
    if (!address) {
      return;
    }

    let closed = false;

    const syncNetwork = async () => {
      try {
        const [currentNetwork, currentAccount] = await Promise.all([getNeoWalletNetwork(), getNeoWalletAccount()]);
        if (closed) {
          return;
        }

        setAddress((prev) => {
          const nextAddress = currentAccount?.address ?? null;
          if (!nextAddress || isSameWalletAddress(prev, nextAddress)) {
            return prev;
          }
          return nextAddress;
        });

        setNetwork((prev) => {
          if (isSameWalletNetwork(prev, currentNetwork)) {
            return prev;
          }

          setRuntimeWalletNetwork(currentNetwork);
          return currentNetwork;
        });
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
  }, [address]);

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
          const account = await connectNeoWallet();
          const walletNetwork = await getNeoWalletNetwork();
          setAddress(account.address);
          setNetwork(walletNetwork);
          setRuntimeWalletNetwork(walletNetwork);
        } finally {
          setIsConnecting(false);
        }
      },
      disconnect: () => {
        setAddress(null);
        setNetwork(null);
        setRuntimeWalletNetwork(null);
      },
      invoke: async (payload: WalletInvokeRequest) => {
        const walletNetwork = await getNeoWalletNetwork();
        setNetwork(walletNetwork);
        setRuntimeWalletNetwork(walletNetwork);
        const result = await invokeNeoWallet(payload);
        return (result.txid ?? result.transaction ?? "").toString();
      },
    }),
    [address, network, isConnecting, isReady],
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
