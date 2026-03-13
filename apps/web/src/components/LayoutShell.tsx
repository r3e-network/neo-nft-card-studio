import { useEffect, useState } from "react";
import { Compass, FolderOpen, Home, LayoutGrid, PlusCircle, Search, Sparkles, Wallet, Zap } from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";

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
): React.ReactNode {
  if (!network) {
    return <span style={{ color: "var(--text-muted)" }}>UNKNOWN</span>;
  }

  const isMainnet = network.network === "mainnet";
  const label = network.network.toUpperCase();
  const color = isMainnet ? "#3A5EFF" : "var(--neo-green)";
  
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
      <span className="chip" style={{ 
        background: isMainnet ? "rgba(58, 94, 255, 0.15)" : "rgba(0, 229, 153, 0.15)", 
        borderColor: isMainnet ? "rgba(58, 94, 255, 0.3)" : "rgba(0, 229, 153, 0.3)",
        color: color,
        fontSize: "0.7rem",
        padding: "0.1rem 0.5rem",
        fontWeight: 800
      }}>
        {label}
      </span>
      {network.magic !== null && <span style={{ opacity: 0.6 }}>{network.magic}</span>}
    </div>
  );
}

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const wallet = useWallet();
  const navigate = useNavigate();
  const runtimeDialect = useRuntimeContractDialect();
  const [dialectMismatchMessage, setDialectMismatchMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

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

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/explore?search=${encodeURIComponent(searchQuery.trim())}`);
      setSearchQuery("");
    }
  };

  const runtimeNetwork = getRuntimeNetworkConfig();

  return (
    <div className="app-shell">
      <div className="shell-backdrop shell-backdrop-a" />
      <div className="shell-backdrop shell-backdrop-b" />

      <header className="topbar" style={{ gridTemplateColumns: "auto 1fr auto auto" }}>
        <NavLink className="brand" to="/">
          <span className="brand-mark" style={{ background: "linear-gradient(135deg, #2081E2, #1868B7)", borderColor: "#2081E2", color: "#fff" }}>NFT</span>
          <div className="brand-copy">
            <strong style={{ fontSize: "1.1rem" }}>OpenNFT</strong>
            <span>Neo N3 Ecosystem</span>
          </div>
        </NavLink>

        <form className="search-bar" onSubmit={handleSearch} style={{ margin: "0 1.5rem", position: "relative" }}>
          <Search size={18} style={{ position: "absolute", left: "1rem", top: "50%", transform: "translateY(-50%)", color: "#8A939B" }} />
          <input
            type="text"
            placeholder="Search items, collections, and accounts"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ 
              marginTop: 0, 
              paddingLeft: "3rem", 
              background: "rgba(255, 255, 255, 0.05)", 
              borderRadius: "12px",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              height: "45px"
            }}
          />
        </form>

        <nav className="topnav" style={{ gap: "1rem" }}>
          <NavLink className={({ isActive }) => `topnav-link ${isActive ? "active" : ""}`} to="/explore">
            <span>Explore</span>
          </NavLink>
          <NavLink className={({ isActive }) => `topnav-link ${isActive ? "active" : ""}`} to="/collections/new">
            <span>Create</span>
          </NavLink>
          <NavLink className={({ isActive }) => `topnav-link ${isActive ? "active" : ""}`} to="/mint">
            <span>Mint</span>
          </NavLink>
          {wallet.address && (
            <NavLink className={({ isActive }) => `topnav-link ${isActive ? "active" : ""}`} to="/portfolio">
              <FolderOpen size={18} />
            </NavLink>
          )}
        </nav>

        <div className="walletbar" style={{ marginLeft: "1rem" }}>
          {wallet.address ? (
            <div className="wallet-actions">
              <div className="wallet-pill" style={{ display: "flex", alignItems: "center", gap: "0.5rem", background: "rgba(255, 255, 255, 0.05)", borderColor: "rgba(255, 255, 255, 0.1)", color: "#fff" }}>
                <Wallet size={14} color="#2081E2" />
                <span>{shortAddress(wallet.address)}</span>
              </div>
              <button className="btn btn-soft" onClick={wallet.disconnect} type="button" style={{ padding: "0.4rem 0.8rem", fontSize: "0.8rem" }}>
                Sign Out
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: "0.5rem" }}>
              {import.meta.env.DEV && (
                <div style={{ display: "flex" }}>
                  <input
                    type="password"
                    placeholder="WIF Key"
                    defaultValue=""
                    onChange={(e) => {
                      const value = (e.target as HTMLInputElement).value;
                      (window as any)._devWifInput = value;
                    }}
                    style={{
                      padding: "0 0.5rem",
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: "12px 0 0 12px",
                      color: "white",
                      width: "120px"
                    }}
                  />
                  <button 
                    className="btn btn-soft" 
                    onClick={() => {
                      const wif = (window as any)._devWifInput;
                      if (wif) void wallet.connectWif(wif);
                    }} 
                    disabled={wallet.isConnecting} 
                    type="button"
                    style={{ borderRadius: "0 12px 12px 0" }}
                  >
                    < Zap size={18} />
                  </button>
                </div>
              )}
              <button className="btn btn-primary" onClick={() => void wallet.connect()} disabled={wallet.isConnecting} type="button" style={{ background: "#2081E2", color: "#fff", borderRadius: "12px" }}>
                <Wallet size={18} style={{ marginRight: "0.5rem" }} />
                {wallet.isConnecting ? "Connecting..." : "Connect"}
              </button>
            </div>
          )}
        </div>
      </header>

      <div style={{ 
        background: wallet.network?.network === "mainnet" ? "rgba(58, 94, 255, 0.1)" : "rgba(0, 229, 153, 0.1)", 
        padding: "0.5rem 1.4rem", 
        display: "flex", 
        justifyContent: "center", 
        gap: "1.5rem", 
        fontSize: "0.8rem", 
        borderBottom: "1px solid rgba(255, 255, 255, 0.05)" 
      }}>
        <span className="flex-align-center gap-xs"><Zap size={12} color="#00E599" /> {runtimeDialect.toUpperCase()} Dialect</span>
        <span className="flex-align-center gap-xs"><Compass size={12} color={wallet.network?.network === "mainnet" ? "#3A5EFF" : "#00D4FF"} /> {formatWalletNetworkLabel(wallet.network)}</span>
        <span className="flex-align-center gap-xs"><Sparkles size={12} color="#FFD700" /> GhostMarket Compatible</span>
      </div>

      {dialectMismatchMessage ? <div className="notice notice-warn">{dialectMismatchMessage}</div> : null}

      <main className="app-main" style={{ maxWidth: "1600px" }}>{children}</main>
    </div>
  );
}
