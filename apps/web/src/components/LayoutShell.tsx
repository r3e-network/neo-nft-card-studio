import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LayoutDashboard, PlusCircle, Sparkles, FolderOpen, Globe2 } from "lucide-react";

import { useWallet } from "../hooks/useWallet";
import { APP_CONFIG } from "../lib/config";
import { fetchContractMeta } from "../lib/api";
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

  const name = network.network.toUpperCase();
  if (network.magic === null) {
    return name;
  }

  return `${name} (${network.magic})`;
}

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const wallet = useWallet();
  const { t, i18n } = useTranslation();
  const runtimeDialect = useRuntimeContractDialect();
  const [dialectMismatchMessage, setDialectMismatchMessage] = useState<string>("");

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
            t("app.dialect_mismatch", {
              runtime: meta.dialect.toUpperCase(),
              env: APP_CONFIG.contractDialect.toUpperCase(),
            }),
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
  }, [wallet.network?.network, wallet.network?.magic, t]);

  const runtimeNetwork = getRuntimeNetworkConfig();
  const missingContractHashWarning = wallet.address
    && (runtimeNetwork.network === "mainnet" || runtimeNetwork.network === "private")
    && !runtimeNetwork.contractHash
    ? t("app.contract_hash_missing", {
      network: runtimeNetwork.network.toUpperCase(),
      env:
        runtimeNetwork.network === "mainnet"
          ? "VITE_NEO_CONTRACT_HASH_MAINNET"
          : "VITE_NEO_CONTRACT_HASH_PRIVATE",
    })
    : "";

  return (
    <div className="app-bg">
      <div className="bg-gradient-orb bg-gradient-orb--1" />
      <div className="bg-gradient-orb bg-gradient-orb--2" />
      <div className="container">
        <header className="main-header">
          <div className="header-brand">
            <div className="brand-row">
              <span className="brand-logo-neo">NEO N3</span>
              <span className="brand-logo-r3e"><span>R3E</span> Network</span>
              <button
                className="btn btn-icon"
                onClick={() => i18n.changeLanguage(i18n.language === "en" ? "zh" : "en")}
                type="button"
                title={t("app.switch_lang")}
              >
                <Globe2 size={18} />
              </button>
            </div>
            <h1 className="title title-highlight">{t("app.title")}</h1>
            <p className="hint">{t("app.dialect")} {runtimeDialect.toUpperCase()}</p>
            <p className="hint">{t("app.wallet_network")} {formatWalletNetworkLabel(wallet.network)}</p>
            {dialectMismatchMessage ? <p className="error">{dialectMismatchMessage}</p> : null}
            {missingContractHashWarning ? <p className="error">{missingContractHashWarning}</p> : null}
          </div>
          <div className="header-actions">
            {wallet.address ? (
              <>
                <span className="wallet-badge">{shortAddress(wallet.address)}</span>
                <button className="btn btn-secondary" onClick={wallet.disconnect} type="button">
                  {t("app.disconnect")}
                </button>
              </>
            ) : (
              <button className="btn" onClick={() => void wallet.connect()} disabled={wallet.isConnecting} type="button">
                {wallet.isConnecting ? t("app.connecting") : wallet.isReady ? t("app.connect") : t("app.install")}
              </button>
            )}
          </div>
        </header>

        <nav className="nav-dock">
          <NavLink className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`} to="/">
            <LayoutDashboard size={20} />
            <span>{t("app.nav_dashboard")}</span>
          </NavLink>
          <NavLink className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`} to="/collections/new">
            <PlusCircle size={20} />
            <span>{t("app.nav_create")}</span>
          </NavLink>
          <NavLink className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`} to="/mint">
            <Sparkles size={20} />
            <span>{t("app.nav_mint")}</span>
          </NavLink>
          <NavLink className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`} to="/portfolio">
            <FolderOpen size={20} />
            <span>{t("app.nav_portfolio")}</span>
          </NavLink>
        </nav>

        <main className="page-body">{children}</main>
      </div>
    </div>
  );
}
