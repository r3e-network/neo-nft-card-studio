import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Layers, Rocket, ShieldCheck, Sparkles } from "lucide-react";

import { fetchCollectionTokens, fetchCollections, fetchStats } from "../lib/api";
import { shortHash } from "../lib/marketplace";
import { buildNftFallbackImage, parseTokenProperties, pickTokenMediaUri } from "../lib/nft-media";
import { useRuntimeContractDialect } from "../lib/runtime-dialect";
import type { CollectionDto, StatsDto, TokenDto } from "../lib/types";
import { useWallet } from "../hooks/useWallet";

interface CollectionPreview {
  imageUri: string;
  tokenId: string;
  tokenName: string;
}

export function HomePage() {
  const contractDialect = useRuntimeContractDialect();
  const wallet = useWallet();

  const [stats, setStats] = useState<StatsDto | null>(null);
  const [collections, setCollections] = useState<CollectionDto[]>([]);
  const [previewsByCollection, setPreviewsByCollection] = useState<Record<string, CollectionPreview>>({});
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
  }, [wallet.network?.network, wallet.network?.magic]);

  const featuredCollections = useMemo(() => collections.slice(0, 8), [collections]);

  useEffect(() => {
    let alive = true;

    const pickCollectionPreview = (collection: CollectionDto, tokens: TokenDto[]): CollectionPreview => {
      const byNewest = [...tokens].sort((a, b) => {
        const aTs = Date.parse(a.mintedAt || a.updatedAt || "");
        const bTs = Date.parse(b.mintedAt || b.updatedAt || "");
        const safeA = Number.isFinite(aTs) ? aTs : 0;
        const safeB = Number.isFinite(bTs) ? bTs : 0;
        return safeB - safeA;
      });

      for (const token of byNewest) {
        const properties = parseTokenProperties(token.propertiesJson);
        const media = pickTokenMediaUri(token, properties);
        if (!media) {
          continue;
        }

        const tokenName = typeof properties.name === "string" && properties.name.trim().length > 0
          ? properties.name.trim()
          : `${collection.name} #${token.tokenId}`;

        return {
          imageUri: media,
          tokenId: token.tokenId,
          tokenName,
        };
      }

      const fallbackToken = byNewest[0];
      const fallbackTokenId = fallbackToken?.tokenId ?? collection.collectionId;
      return {
        imageUri: buildNftFallbackImage(collection.name, fallbackTokenId, collection.name),
        tokenId: fallbackTokenId,
        tokenName: `${collection.name} #${fallbackTokenId}`,
      };
    };

    (async () => {
      if (featuredCollections.length === 0) {
        if (alive) {
          setPreviewsByCollection({});
        }
        return;
      }

      const entries = await Promise.all(
        featuredCollections.map(async (collection) => {
          try {
            const tokens = await fetchCollectionTokens(collection.collectionId);
            const preview = pickCollectionPreview(collection, tokens);
            return [collection.collectionId, preview] as const;
          } catch {
            return [collection.collectionId, {
              imageUri: buildNftFallbackImage(collection.name, collection.collectionId, collection.name),
              tokenId: collection.collectionId,
              tokenName: `${collection.name} #${collection.collectionId}`,
            } as CollectionPreview] as const;
          }
        }),
      );

      if (!alive) {
        return;
      }

      setPreviewsByCollection(Object.fromEntries(entries));
    })();

    return () => {
      alive = false;
    };
  }, [featuredCollections, wallet.network?.network, wallet.network?.magic]);

  return (
    <div className="stack-lg fade-in" style={{ gap: "4rem" }}>
      {/* Hero Section */}
      <section style={{ 
        display: "grid", 
        gridTemplateColumns: "1fr 1fr", 
        gap: "2rem", 
        alignItems: "center",
        padding: "4rem 0",
        minHeight: "70vh"
      }}>
        <div className="stack-md">
          <h1 style={{ fontSize: "4.5rem", fontWeight: 800, lineHeight: 1, letterSpacing: "-0.04em", margin: 0 }}>
            Discover, collect, and sell extraordinary NFTs
          </h1>
          <p style={{ fontSize: "1.5rem", color: "#8A939B", lineHeight: 1.4, maxWidth: "540px", margin: "1.5rem 0" }}>
            A Neo N3 NFT platform to launch collections, mint assets, and trade on-chain with factory and dedicated contract modes.
          </p>
          <div style={{ display: "flex", gap: "1rem" }}>
            <Link className="btn btn-lg" to="/explore" style={{ padding: "1.2rem 2.5rem", borderRadius: "12px", background: "#2081E2", color: "#fff" }}>
              Explore
            </Link>
            <Link className="btn btn-secondary btn-lg" to="/collections/new" style={{ padding: "1.2rem 2.5rem", borderRadius: "12px" }}>
              Create
            </Link>
          </div>
        </div>
        
        <div style={{ position: "relative" }}>
          <div className="panel" style={{ padding: 0, borderRadius: "20px", overflow: "hidden", border: "1px solid rgba(255, 255, 255, 0.1)" }}>
            <img 
              src="https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?auto=format&fit=crop&q=80&w=1000" 
              alt="Hero NFT" 
              style={{ width: "100%", height: "450px", objectFit: "cover" }} 
            />
            <div style={{ padding: "1.5rem", display: "flex", alignItems: "center", gap: "1rem" }}>
              <div style={{ width: "45px", height: "45px", borderRadius: "50%", background: "linear-gradient(45deg, #00E599, #00D4FF)" }}></div>
              <div>
                <div style={{ fontWeight: 700, fontSize: "1.1rem" }}>Ethereal Horizon #42</div>
                <div style={{ color: "#2081E2", fontSize: "0.9rem" }}>R3E Studios</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="metric-grid" style={{ background: "rgba(255, 255, 255, 0.03)", padding: "2rem", borderRadius: "20px", border: "1px solid rgba(255, 255, 255, 0.05)" }}>
        <article style={{ textAlign: "center" }}>
          <div style={{ fontSize: "0.9rem", color: "#8A939B", fontWeight: 600, textTransform: "uppercase" }}>Collections</div>
          <div style={{ fontSize: "2.5rem", fontWeight: 800 }}>{stats?.collectionCount ?? "-"}</div>
        </article>
        <article style={{ textAlign: "center" }}>
          <div style={{ fontSize: "0.9rem", color: "#8A939B", fontWeight: 600, textTransform: "uppercase" }}>Total Items</div>
          <div style={{ fontSize: "2.5rem", fontWeight: 800 }}>{stats?.tokenCount ?? "-"}</div>
        </article>
        <article style={{ textAlign: "center" }}>
          <div style={{ fontSize: "0.9rem", color: "#8A939B", fontWeight: 600, textTransform: "uppercase" }}>Volume</div>
          <div style={{ fontSize: "2.5rem", fontWeight: 800 }}>{stats?.transferCount ?? "-"} <span style={{ fontSize: "1rem" }}>GAS</span></div>
        </article>
      </section>

      {/* Mode Selection Section */}
      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem" }}>
        <div className="panel" style={{ padding: "2.5rem", background: "rgba(32, 129, 226, 0.05)", borderColor: "rgba(32, 129, 226, 0.2)" }}>
          <div className="stack-sm">
            <Layers size={32} color="#2081E2" />
            <h2 style={{ fontSize: "1.8rem", margin: "1rem 0" }}>Shared Factory</h2>
            <p style={{ color: "#8A939B", lineHeight: 1.6 }}>
              Launch your collection instantly on our shared NEP-11 contract. Perfect for creators who want to get started without high deployment costs.
            </p>
            <div className="chip-row" style={{ marginTop: "1rem" }}>
              <span className="chip" style={{ background: "rgba(0, 229, 153, 0.1)", borderColor: "rgba(0, 229, 153, 0.2)", color: "#00E599" }}>Low Cost</span>
              <span className="chip">Instant Launch</span>
            </div>
          </div>
        </div>

        <div className="panel" style={{ padding: "2.5rem", background: "rgba(0, 229, 153, 0.05)", borderColor: "rgba(0, 229, 153, 0.2)" }}>
          <div className="stack-sm">
            <ShieldCheck size={32} color="#00E599" />
            <h2 style={{ fontSize: "1.8rem", margin: "1rem 0" }}>Dedicated Contract</h2>
            <p style={{ color: "#8A939B", lineHeight: 1.6 }}>
              Deploy a dedicated NFT contract for complete ownership and isolation. Customize your contract hash and manage everything independently.
            </p>
            <div className="chip-row" style={{ marginTop: "1rem" }}>
              <span className="chip" style={{ background: "rgba(32, 129, 226, 0.1)", borderColor: "rgba(32, 129, 226, 0.2)", color: "#2081E2" }}>10 GAS Fee</span>
              <span className="chip">Full Isolation</span>
            </div>
          </div>
        </div>
      </section>

      {/* Featured Collections Grid */}
      <section>
        <div className="panel-header" style={{ marginBottom: "2rem" }}>
          <h2 style={{ fontSize: "2rem", fontWeight: 700 }}>Notable Collections</h2>
          <Link to="/explore" style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: 600, color: "#2081E2" }}>
            See all <ArrowRight size={18} />
          </Link>
        </div>

        {loading ? (
          <div style={{ display: "grid", gap: "1.5rem", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="panel" style={{ height: "380px", background: "rgba(255,255,255,0.05)" }}></div>
            ))}
          </div>
        ) : featuredCollections.length === 0 ? (
          <div className="panel" style={{ textAlign: "center", padding: "4rem" }}>
            <Sparkles size={48} color="#8A939B" style={{ marginBottom: "1rem" }} />
            <h3>No collections found</h3>
            <p className="hint">Be the first to create an amazing NFT collection on Neo N3!</p>
            <Link className="btn" to="/collections/new" style={{ marginTop: "1.5rem" }}>Create Collection</Link>
          </div>
        ) : (
          <div style={{ display: "grid", gap: "1.5rem", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
            {featuredCollections.map((collection) => (
              <Link
                key={collection.collectionId}
                to={`/collections/${collection.collectionId}`}
                style={{ textDecoration: "none", color: "inherit" }}
              >
                {(() => {
                  const preview = previewsByCollection[collection.collectionId];
                  const fallbackImage = buildNftFallbackImage(collection.name, collection.collectionId, collection.name);
                  const imageSrc = preview?.imageUri || fallbackImage;
                  const tokenLabel = preview?.tokenName || `${collection.name} #${collection.collectionId}`;

                  return (
                <div className="panel" style={{ padding: 0, overflow: "hidden", transition: "transform 0.2s" }} onMouseOver={(e) => e.currentTarget.style.transform = "translateY(-8px)"} onMouseOut={(e) => e.currentTarget.style.transform = "translateY(0)"}>
                  <div style={{ height: "200px", background: "#121822", position: "relative" }}>
                    <img
                      src={imageSrc}
                      alt={collection.name}
                      loading="lazy"
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                    <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(4,6,10,0.82), rgba(4,6,10,0.12))" }} />
                    <div style={{ position: "absolute", bottom: "10px", left: "12px", right: "12px", color: "#fff", fontSize: "0.85rem", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {tokenLabel}
                    </div>
                  </div>
                  <div style={{ padding: "1rem 1.5rem 1.5rem" }}>
                    <h3 style={{ margin: 0, fontSize: "1.25rem" }}>{collection.name}</h3>
                    <div style={{ color: "#8A939B", fontSize: "0.9rem", margin: "0.25rem 0 1rem" }}>by {shortHash(collection.owner)}</div>
                    <div className="chip-row">
                      <span className="chip" style={{ fontSize: "0.75rem" }}>{collection.minted} items</span>
                      <span className="chip" style={{ fontSize: "0.75rem" }}>{(collection.royaltyBps / 100).toFixed(1)}% royalty</span>
                    </div>
                  </div>
                </div>
                  );
                })()}
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
