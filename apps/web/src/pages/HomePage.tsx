import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Layers, Rocket, ShieldCheck, Sparkles } from "lucide-react";

import { fetchCollections, fetchStats } from "../lib/api";
import { shortHash } from "../lib/marketplace";
import { useRuntimeContractDialect } from "../lib/runtime-dialect";
import type { CollectionDto, StatsDto } from "../lib/types";

export function HomePage() {
  const contractDialect = useRuntimeContractDialect();

  const [stats, setStats] = useState<StatsDto | null>(null);
  const [collections, setCollections] = useState<CollectionDto[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      try {
        const [nextStats, nextCollections] = await Promise.all([fetchStats(), fetchCollections()]);
        if (!alive) {
          return;
        }
        setStats(nextStats);
        setCollections(nextCollections);
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const featuredCollections = useMemo(() => collections.slice(0, 6), [collections]);

  return (
    <div className="stack-lg fade-in">
      <section className="panel" style={{ padding: "3rem" }}>
        <div className="stack-md" style={{ maxWidth: "760px" }}>
          <h1 className="title title-highlight" style={{ fontSize: "clamp(2rem, 4vw, 3.5rem)", lineHeight: 1.1 }}>
            Publish, Showcase, and Trade NFTs on Neo N3
          </h1>
          <p className="hint" style={{ fontSize: "1.05rem", lineHeight: 1.7 }}>
            R3E marketplace supports both shared factory collections and dedicated NFT contracts. Metadata is GhostMarket
            compatible, and each NFT can be listed or purchased directly on-chain.
          </p>
          <div className="chip-row" style={{ marginTop: "0.5rem" }}>
            <span className="chip">Dialect {contractDialect.toUpperCase()}</span>
            <span className="chip">NEP-11 / NEP-24</span>
            <span className="chip">GhostMarket Compatible</span>
          </div>
          <div className="token-actions" style={{ borderTop: "none", marginTop: "0.25rem", paddingTop: 0 }}>
            <Link className="btn" to="/explore">
              <Rocket size={16} /> Explore Marketplace
            </Link>
            <Link className="btn btn-secondary" to="/collections/new">
              <Sparkles size={16} /> Launch Collection
            </Link>
            <Link className="btn btn-secondary" to="/mint">
              Mint NFT
            </Link>
          </div>
        </div>
      </section>

      <section className="metric-grid">
        <article className="metric-card">
          <p>Total Collections</p>
          <h2>{stats?.collectionCount ?? "-"}</h2>
        </article>
        <article className="metric-card">
          <p>Total NFTs</p>
          <h2>{stats?.tokenCount ?? "-"}</h2>
        </article>
        <article className="metric-card">
          <p>Total Transfers</p>
          <h2>{stats?.transferCount ?? "-"}</h2>
        </article>
      </section>

      <section className="grid-two">
        <article className="panel" style={{ minHeight: "260px" }}>
          <div className="panel-header">
            <h3 style={{ alignItems: "center", display: "flex", gap: "0.5rem", margin: 0 }}>
              <Layers size={18} /> Shared Factory Mode
            </h3>
          </div>
          <p className="hint" style={{ lineHeight: 1.7 }}>
            Deploy collection metadata on the platform factory (single NEP-11 contract). Collection ownership is separated
            by `collectionId`, similar to storefront-style models.
          </p>
          <div className="chip-row" style={{ marginTop: "1rem" }}>
            <span className="chip">No extra deployment fee</span>
            <span className="chip">Fast launch</span>
          </div>
        </article>

        <article className="panel" style={{ minHeight: "260px" }}>
          <div className="panel-header">
            <h3 style={{ alignItems: "center", display: "flex", gap: "0.5rem", margin: 0 }}>
              <ShieldCheck size={18} /> Dedicated Contract Mode
            </h3>
          </div>
          <p className="hint" style={{ lineHeight: 1.7 }}>
            For C# mode, each collection can deploy its own isolated NFT contract from template. This costs 10 GAS and is
            suited for advanced creators needing full contract-level isolation.
          </p>
          <div className="chip-row" style={{ marginTop: "1rem" }}>
            <span className="chip">10 GAS deployment</span>
            <span className="chip">Per-collection contract hash</span>
          </div>
        </article>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Featured Collections</h3>
          <Link className="btn btn-secondary" to="/explore">
            View All
          </Link>
        </div>

        {loading ? (
          <p className="hint">Loading collections...</p>
        ) : featuredCollections.length === 0 ? (
          <p className="hint">No collections yet. Create the first one.</p>
        ) : (
          <div style={{ display: "grid", gap: "1rem", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
            {featuredCollections.map((collection) => (
              <Link
                className="token-card"
                key={collection.collectionId}
                style={{ color: "inherit", textDecoration: "none" }}
                to={`/collections/${collection.collectionId}`}
              >
                <div className="stack-sm">
                  <strong>{collection.name}</strong>
                  <span className="hint">{collection.symbol}</span>
                </div>
                <div className="chip-row">
                  <span className="chip">Minted {collection.minted}</span>
                  <span className="chip">Royalty {(collection.royaltyBps / 100).toFixed(2)}%</span>
                </div>
                <span className="hint">Owner {shortHash(collection.owner)}</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
