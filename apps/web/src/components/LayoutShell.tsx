import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Compass, FolderOpen, Lock, Search, Sparkles, Wallet, Zap } from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { useWallet } from "../hooks/useWallet";
import { fetchContractMeta } from "../lib/api";
import { BUILD_INFO } from "../lib/build-info";
import { APP_CONFIG } from "../lib/config";
import {
  getRuntimeNetworkConfig,
  setRuntimeSelectedFrontendNetwork,
  type FrontendNetworkName,
  useRuntimeNetworkState,
} from "../lib/runtime-network";
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

function formatNetworkNameLabel(network: "mainnet" | "testnet" | "private" | "unknown"): string {
  return network.toUpperCase();
}

function getFallbackAvailableNetworks(): FrontendNetworkName[] {
  const options: FrontendNetworkName[] = ["testnet", "mainnet"];
  if (APP_CONFIG.networks.private.apiBaseUrl || APP_CONFIG.networks.private.rpcUrl || APP_CONFIG.networks.private.contractHash) {
    options.push("private");
  }
  return options;
}

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const wallet = useWallet();
  const navigate = useNavigate();
  const runtimeDialect = useRuntimeContractDialect();
  const runtimeState = useRuntimeNetworkState();
  const [dialectMismatchMessage, setDialectMismatchMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [availableNetworks, setAvailableNetworks] = useState<FrontendNetworkName[]>(() => getFallbackAvailableNetworks());
  const [apiRevision, setApiRevision] = useState("");

  const walletKnownNetwork = runtimeState.walletNetwork && runtimeState.walletNetwork.network !== "unknown"
    ? runtimeState.walletNetwork.network
    : null;
  const hasWalletMismatch = Boolean(walletKnownNetwork && walletKnownNetwork !== runtimeState.selectedNetwork);

  useEffect(() => {
    if (walletKnownNetwork && runtimeState.selectedNetwork !== walletKnownNetwork) {
      setRuntimeSelectedFrontendNetwork(walletKnownNetwork);
    }
  }, [runtimeState.selectedNetwork, walletKnownNetwork]);

  useEffect(() => {
    let cancelled = false;

    const syncDialect = async () => {
      try {
        const meta = await fetchContractMeta();
        if (cancelled) {
          return;
        }

        setRuntimeContractDialect(meta.dialect);
        setApiRevision(meta.revision?.trim() ?? "");
        const nextAvailableNetworks = meta.availableNetworks?.length
          ? meta.availableNetworks
          : getFallbackAvailableNetworks();
        setAvailableNetworks(nextAvailableNetworks);

        if (
          !walletKnownNetwork &&
          nextAvailableNetworks.length > 0 &&
          !nextAvailableNetworks.includes(runtimeState.selectedNetwork) &&
          meta.network
        ) {
          setRuntimeSelectedFrontendNetwork(meta.network);
        }

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
        setAvailableNetworks(getFallbackAvailableNetworks());
        setApiRevision("");
        setDialectMismatchMessage("");
      }
    };

    void syncDialect();
    return () => {
      cancelled = true;
    };
  }, [runtimeState.runtimeKey, runtimeState.selectedNetwork, walletKnownNetwork]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/explore?search=${encodeURIComponent(searchQuery.trim())}`);
      setSearchQuery("");
    }
  };

  const runtimeNetwork = getRuntimeNetworkConfig();
  const networkTone = runtimeNetwork.network === "mainnet"
    ? "#3A5EFF"
    : runtimeNetwork.network === "unknown"
      ? "#F59E0B"
      : "#00D4FF";
  const networkStatusLabel = useMemo(() => {
    if (!walletKnownNetwork) {
      return t("app.network_status_no_wallet");
    }
    return hasWalletMismatch ? t("app.network_status_mismatch") : t("app.network_status_matched");
  }, [hasWalletMismatch, t, walletKnownNetwork]);
  const networkSelectionLocked = Boolean(walletKnownNetwork);

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
        background: runtimeNetwork.network === "mainnet" ? "rgba(58, 94, 255, 0.1)" : "rgba(0, 229, 153, 0.1)", 
        padding: "0.5rem 1.4rem", 
        display: "flex", 
        justifyContent: "center",
        flexWrap: "wrap",
        gap: "1.5rem", 
        fontSize: "0.8rem", 
        borderBottom: "1px solid rgba(255, 255, 255, 0.05)" 
      }}>
        <span className="flex-align-center gap-xs"><Zap size={12} color="#00E599" /> {runtimeDialect.toUpperCase()} Dialect</span>
        <span className="flex-align-center gap-xs" style={{ gap: "0.6rem" }}>
          <span style={{ opacity: 0.7 }}>{t("app.frontend_network")}</span>
          <span style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
            {availableNetworks.map((network) => {
              const selected = runtimeState.selectedNetwork === network;
              const disabled = networkSelectionLocked && walletKnownNetwork !== network;
              return (
                <button
                  key={network}
                  className="btn"
                  disabled={disabled}
                  onClick={() => setRuntimeSelectedFrontendNetwork(network)}
                  type="button"
                  title={disabled ? t("app.network_locked_to_wallet") : undefined}
                  style={{
                    padding: "0.2rem 0.55rem",
                    fontSize: "0.72rem",
                    minHeight: "unset",
                    borderRadius: "999px",
                    background: selected ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.04)",
                    border: selected ? "1px solid rgba(255,255,255,0.22)" : "1px solid rgba(255,255,255,0.1)",
                    color: "#fff",
                    opacity: disabled ? 0.45 : 1,
                    cursor: disabled ? "not-allowed" : "pointer",
                  }}
                >
                  {formatNetworkNameLabel(network)}
                </button>
              );
            })}
          </span>
        </span>
        <span className="flex-align-center gap-xs"><Compass size={12} color={wallet.network?.network === "mainnet" ? "#3A5EFF" : wallet.network?.network === "unknown" ? "#F59E0B" : "#00D4FF"} /> {formatWalletNetworkLabel(wallet.network)}</span>
        <span className="flex-align-center gap-xs" style={{ gap: "0.6rem" }}>
          <span style={{ opacity: 0.7 }}>{t("app.active_network")}</span>
          <span className="chip" style={{ background: "rgba(255,255,255,0.08)", borderColor: "rgba(255,255,255,0.12)", color: networkTone }}>
            {formatNetworkNameLabel(runtimeNetwork.network)}
          </span>
        </span>
        <span className="flex-align-center gap-xs" style={{ gap: "0.6rem" }}>
          <span style={{ opacity: 0.7 }}>{t("app.network_match")}</span>
          <span className="chip" style={{
            background: hasWalletMismatch ? "rgba(245, 158, 11, 0.14)" : "rgba(0, 229, 153, 0.12)",
            borderColor: hasWalletMismatch ? "rgba(245, 158, 11, 0.24)" : "rgba(0, 229, 153, 0.22)",
            color: hasWalletMismatch ? "#F59E0B" : "#00E599",
          }}>
            {networkStatusLabel}
          </span>
        </span>
        <span className="flex-align-center gap-xs"><Sparkles size={12} color="#FFD700" /> GhostMarket Compatible</span>
        {networkSelectionLocked ? (
          <span className="flex-align-center gap-xs" style={{ color: "var(--text-muted)" }}>
            <Lock size={12} color="#F59E0B" /> {t("app.network_locked_to_wallet")}
          </span>
        ) : null}
        <span className="flex-align-center gap-xs" style={{ color: "var(--text-muted)" }}>
          rev {apiRevision || BUILD_INFO.revision}
        </span>
      </div>

      {dialectMismatchMessage ? <div className="notice notice-warn">{dialectMismatchMessage}</div> : null}
      {hasWalletMismatch ? (
        <div className="notice notice-warn" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
          <span style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <AlertTriangle size={16} />
            {t("app.network_mismatch_notice", {
              selected: formatNetworkNameLabel(runtimeState.selectedNetwork),
              wallet: formatNetworkNameLabel(walletKnownNetwork ?? "unknown"),
            })}
          </span>
          {walletKnownNetwork ? (
            <button
              className="btn btn-soft"
              onClick={() => setRuntimeSelectedFrontendNetwork(walletKnownNetwork)}
              type="button"
              style={{ padding: "0.45rem 0.85rem", fontSize: "0.8rem" }}
            >
              {t("app.use_wallet_network")}
            </button>
          ) : null}
        </div>
      ) : null}
      {networkSelectionLocked ? (
        <div className="notice" style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <Lock size={16} color="#F59E0B" />
          <span>{t("app.network_switch_requires_wallet_change", { wallet: formatNetworkNameLabel(walletKnownNetwork ?? "unknown") })}</span>
        </div>
      ) : null}

      <main className="app-main" key={runtimeState.runtimeKey} style={{ maxWidth: "1600px" }}>{children}</main>
    </div>
  );
}
