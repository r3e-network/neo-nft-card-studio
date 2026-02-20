import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CopySlash, Layers, ArrowLeftRight, Activity, Database, AlertTriangle, Cpu, CheckCircle } from "lucide-react";
import { NeoRpcService } from "@platform/neo-sdk";

import { useWallet } from "../hooks/useWallet";
import { fetchCollections, fetchGhostMarketMeta, fetchStats } from "../lib/api";
import { getRuntimeNetworkConfig } from "../lib/runtime-network";
import type { CollectionDto, GhostMarketMetaDto, StatsDto } from "../lib/types";

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

function formatMaxSupply(value: string): string {
  const normalized = value.trim();
  return normalized === "0" ? "∞" : value;
}

interface CompatibilityIssue {
  code: string;
  message: string;
  params?: Record<string, string>;
}

export function HomePage() {
  const { t } = useTranslation();
  const wallet = useWallet();
  const [stats, setStats] = useState<StatsDto | null>(null);
  const [chainHeight, setChainHeight] = useState<number | null>(null);
  const [activeRpcUrl, setActiveRpcUrl] = useState<string>("");
  const [ghostMarket, setGhostMarket] = useState<GhostMarketMetaDto | null>(null);
  const [collections, setCollections] = useState<CollectionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const runtime = getRuntimeNetworkConfig();
        setActiveRpcUrl(runtime.rpcUrl);

        const runtimeRpc = new NeoRpcService({
          rpcUrl: runtime.rpcUrl,
          contractHash: runtime.contractHash || "0x0000000000000000000000000000000000000000",
        });

        const [fetchedStats, fetchedGhostMarket, fetchedCollections, fetchedBlockCount] = await Promise.all([
          fetchStats(),
          fetchGhostMarketMeta(),
          fetchCollections(),
          runtimeRpc.getBlockCount().catch(() => null),
        ]);

        if (!alive) {
          return;
        }

        setStats(fetchedStats);
        setGhostMarket(fetchedGhostMarket);
        setCollections(fetchedCollections);
        setChainHeight(typeof fetchedBlockCount === "number" ? fetchedBlockCount - 1 : null);
      } catch (err) {
        if (!alive) {
          return;
        }
        setError((err as Error).message);
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [wallet.network?.network, wallet.network?.magic]);

  const myCollections = useMemo(() => {
    if (!wallet.address) {
      return [];
    }
    return collections.filter((collection) => collection.owner === wallet.address);
  }, [wallet.address, collections]);

  const mapCompatibilityIssue = (issue: CompatibilityIssue | string): string => {
    if (typeof issue === "string") {
      return issue;
    }

    const key = `home.ghost_issue_${issue.code}`;
    const translated = t(key, issue.params ?? {});
    if (translated === key) {
      return t("home.ghost_issue_unknown", {
        code: issue.code,
        message: issue.message,
      });
    }
    return translated;
  };

  const reasonIssues: Array<CompatibilityIssue | string> = ghostMarket?.compatibility.reasonIssues ??
    ghostMarket?.compatibility.reasons ??
    [];
  const warningIssues: Array<CompatibilityIssue | string> = ghostMarket?.compatibility.warningIssues ??
    ghostMarket?.compatibility.warnings ??
    [];

  return (
    <section className="stack-lg fade-in">
      <div className="metric-grid">
        <article className="metric-card">
          <p style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Layers size={14} /> {t("home.tot_collections")}
          </p>
          <h2>{stats?.collectionCount ?? "-"}</h2>
        </article>
        <article className="metric-card">
          <p style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <CopySlash size={14} /> {t("home.tot_nfts")}
          </p>
          <h2>{stats?.tokenCount ?? "-"}</h2>
        </article>
        <article className="metric-card">
          <p style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <ArrowLeftRight size={14} /> {t("home.tot_transfers")}
          </p>
          <h2>{stats?.transferCount ?? "-"}</h2>
        </article>
        <article className="metric-card">
          <p style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Activity size={14} /> {t("home.idx_cursor")}
          </p>
          <h2>{chainHeight ?? "-"}</h2>
          {activeRpcUrl ? (
            <p className="hint">
              {t("home.endpoint_url")}: {activeRpcUrl}
            </p>
          ) : null}
        </article>
      </div>

      {ghostMarket ? (
        <article className="panel">
          <div className="panel-header" style={{ marginBottom: '1rem' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Cpu size={18} /> {t("home.ghost_compat")}
            </h3>
            <span className="hint" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              {ghostMarket.compatibility.compatible ? <CheckCircle size={14} color="#10B981" /> : <AlertTriangle size={14} color="#F59E0B" />}
              {ghostMarket.compatibility.compatible ? t("home.ghost_status_compatible") : t("home.ghost_status_adjust")}
            </span>
          </div>
          <p className={ghostMarket.compatibility.compatible ? "success" : "error"}>
            {ghostMarket.compatibility.compatible
              ? t("home.ghost_msg_ok")
              : t("home.ghost_msg_bad")}
          </p>
          <p className="hint">
            <a href={ghostMarket.contractSearchUrl} target="_blank" rel="noreferrer">
              {t("home.ghost_open_search")}
            </a>
          </p>
          {reasonIssues.length > 0 ? (
            <ul className="hint">
              {reasonIssues.map((reason, index) => (
                <li key={`reason-${index}`}>{mapCompatibilityIssue(reason)}</li>
              ))}
            </ul>
          ) : null}
          {warningIssues.length > 0 ? (
            <ul className="hint">
              {warningIssues.map((warning, index) => (
                <li key={`warning-${index}`}>{mapCompatibilityIssue(warning)}</li>
              ))}
            </ul>
          ) : null}
        </article>
      ) : null}

      {loading ? <p className="hint">{t("home.loading")}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      <div className="grid-two">
        <section className="panel">
          <div className="panel-header" style={{ borderBottom: 'none', paddingBottom: 0 }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Database size={18} /> {t("home.latest_cols")}
            </h3>
            <span className="hint">{collections.length} {t("home.records")}</span>
          </div>
          {collections.length === 0 ? (
            <p className="hint">{t("home.no_cols")}</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("home.name")}</th>
                    <th>{t("home.symbol")}</th>
                    <th>{t("home.minted_max")}</th>
                    <th>{t("home.created")}</th>
                  </tr>
                </thead>
                <tbody>
                  {collections.slice(0, 20).map((collection) => (
                    <tr key={collection.collectionId}>
                      <td>
                        <Link to={`/collections/${collection.collectionId}`}>{collection.name}</Link>
                      </td>
                      <td>{collection.symbol}</td>
                      <td>
                        {collection.minted} / {formatMaxSupply(collection.maxSupply)}
                      </td>
                      <td>{formatDate(collection.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-header" style={{ borderBottom: 'none', paddingBottom: 0 }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Layers size={18} /> {t("home.my_cols")}
            </h3>
            <span className="hint">{t("home.wallet_scoped")}</span>
          </div>
          {!wallet.address ? (
            <p className="hint">{t("home.connect_to_view")}</p>
          ) : myCollections.length === 0 ? (
            <p className="hint">{t("home.no_owned")}</p>
          ) : (
            <ul className="card-list">
              {myCollections.map((collection) => (
                <li className="mini-card" key={collection.collectionId}>
                  <p className="mini-card-title">{collection.name}</p>
                  <p className="hint">{collection.collectionId}</p>
                  <Link className="inline-link" to={`/collections/${collection.collectionId}`}>
                    {t("home.manage")}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}
