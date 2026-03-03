import { useEffect, useState } from "react";
import { Compass, FolderOpen, Home, PlusCircle, Sparkles, Wallet, Zap } from "lucide-react";
import { NavLink } from "react-router-dom";

import { useWallet } from "../hooks/useWallet";
import { fetchContractMeta } from "../lib/api";
import { APP_CONFIG } from "../lib/config";
import { getRuntimeNetworkConfig } from "../lib/runtime-network";
import {
  resetRuntimeContractDialect,
  setRuntimeContractDialect,
  useRuntimeContractDialect,
} from "../lib/runtime-dialect";

function shortAddress(address: string): string {
  if (address.length <= 12) {
    return address;
  }
  return `${address.slice(0, 6)}...${address.slice(-6)}`;
}

function formatWalletNetworkLabel(
  network: { network: "mainnet" | "testnet" | "private" | "unknown"; magic: number | null } | null,
): string {
  if (!network) {
    return "UNKNOWN";
  }

  const label = network.network.toUpperCase();
  if (network.magic === null) {
    return label;
  }

  return `${label} · ${network.magic}`;
}

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const wallet = useWallet();
  const runtimeDialect = useRuntimeContractDialect();
  const [dialectMismatchMessage, setDialectMismatchMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    const syncDialect = async () => {
      try {
        const meta = await fetchContractMeta();
        if (cancelled) {
          return;
        }

        setRuntimeContractDialect(meta.dialect);
        if (meta.dialect !== APP_CONFIG.contractDialect) {
          setDialectMismatchMessage(
            `Runtime dialect ${meta.dialect.toUpperCase()} differs from env ${APP_CONFIG.contractDialect.toUpperCase()}.`,
          );
          return;
        }

        setDialectMismatchMessage("");
      } catch {
        if (cancelled) {
          return;
        }
        resetRuntimeContractDialect();
        setDialectMismatchMessage("");
      }
    };

    void syncDialect();
    return () => {
      cancelled = true;
    };
  }, [wallet.network?.network, wallet.network?.magic]);

  const runtimeNetwork = getRuntimeNetworkConfig();
  const missingContractHashWarning = wallet.address
    && (runtimeNetwork.network === "mainnet" || runtimeNetwork.network === "private")
    && !runtimeNetwork.contractHash
    ? `Contract hash is missing for ${runtimeNetwork.network.toUpperCase()} network.`
    : "";

  return (
    <div className="app-shell">
      <div className="shell-backdrop shell-backdrop-a" />
      <div className="shell-backdrop shell-backdrop-b" />

      <header className="topbar">
        <NavLink className="brand" to="/">
          <span className="brand-mark">R3E</span>
          <div className="brand-copy">
            <strong>NFT Exchange</strong>
            <span>Neo N3 · GhostMarket Compatible</span>
          </div>
        </NavLink>

        <nav className="topnav">
          <NavLink className={({ isActive }) => `topnav-link ${isActive ? "active" : ""}`} to="/">
            <Home size={16} />
            <span>Home</span>
          </NavLink>
          <NavLink className={({ isActive }) => `topnav-link ${isActive ? "active" : ""}`} to="/explore">
            <Compass size={16} />
            <span>Explore</span>
          </NavLink>
          <NavLink className={({ isActive }) => `topnav-link ${isActive ? "active" : ""}`} to="/collections/new">
            <PlusCircle size={16} />
            <span>Create</span>
          </NavLink>
          <NavLink className={({ isActive }) => `topnav-link ${isActive ? "active" : ""}`} to="/mint">
            <Sparkles size={16} />
            <span>Mint</span>
          </NavLink>
          <NavLink className={({ isActive }) => `topnav-link ${isActive ? "active" : ""}`} to="/portfolio">
            <FolderOpen size={16} />
            <span>Portfolio</span>
          </NavLink>
        </nav>

        <div className="walletbar">
          <div className="tagline">
            <span className="tag">
              <Zap size={12} />
              {runtimeDialect.toUpperCase()}
            </span>
            <span className="tag">
              <Wallet size={12} />
              {formatWalletNetworkLabel(wallet.network)}
            </span>
          </div>
          {wallet.address ? (
            <div className="wallet-actions">
              <span className="wallet-pill">{shortAddress(wallet.address)}</span>
              <button className="btn btn-soft" onClick={wallet.disconnect} type="button">
                Disconnect
              </button>
            </div>
          ) : (
            <button className="btn btn-primary" onClick={() => void wallet.connect()} disabled={wallet.isConnecting} type="button">
              {wallet.isConnecting ? "Connecting..." : wallet.isReady ? "Connect Wallet" : "Install Wallet"}
            </button>
          )}
        </div>
      </header>

      {dialectMismatchMessage ? <div className="notice notice-warn">{dialectMismatchMessage}</div> : null}
      {missingContractHashWarning ? <div className="notice notice-error">{missingContractHashWarning}</div> : null}

      <main className="app-main">{children}</main>
    </div>
  );
}
