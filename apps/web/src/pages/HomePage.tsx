import { useEffect, useMemo, useState } from "react";
import { Layers, ShieldCheck } from "lucide-react";

import { fetchCollectionTokens, fetchCollections, fetchStats } from "../lib/api";
import { pickCollectionPreview, type CollectionPreview } from "../lib/nft-media";
import type { CollectionDto, StatsDto } from "../lib/types";
import { useWallet } from "../hooks/useWallet";

import { HeroSection } from "../components/home/HeroSection";
import { StatsSection } from "../components/home/StatsSection";
import { FeaturedCollections } from "../components/home/FeaturedCollections";

export function HomePage() {
  const wallet = useWallet();

  const [stats, setStats] = useState<StatsDto | null>(null);
  const [collections, setCollections] = useState<CollectionDto[]>([]);
  const [previewsByCollection, setPreviewsByCollection] = useState<Record<string, CollectionPreview>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      setError("");
      try {
        const [nextStats, nextCollections] = await Promise.all([fetchStats(), fetchCollections()]);
        if (!alive) {
          return;
        }
        setStats(nextStats);
        setCollections(nextCollections);
      } catch {
        if (!alive) {
          return;
        }

        setStats(null);
        setCollections([]);
        setPreviewsByCollection({});
        setError("Failed to load featured collections and platform stats.");
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
            return [collection.collectionId, pickCollectionPreview(collection, [])] as const;
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
      <HeroSection />

      <StatsSection stats={stats} />

      {error ? (
        <section className="panel" style={{ padding: "1rem 1.25rem", color: "var(--text-muted)" }}>
          {error}
        </section>
      ) : null}

      {/* Mode Selection Section */}
      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem" }}>
        <div className="panel mode-card mode-shared">
          <div className="stack-sm">
            <Layers size={32} color="var(--neo-green)" />
            <h2 style={{ fontSize: "1.8rem", margin: "1rem 0" }}>Shared Factory</h2>
            <p style={{ color: "var(--text-muted)", lineHeight: 1.6 }}>
              Launch your collection instantly on our shared NEP-11 contract. Perfect for creators who want to get started without high deployment costs.
            </p>
            <div className="chip-row" style={{ marginTop: "1rem" }}>
              <span className="chip chip-success">Low Cost</span>
              <span className="chip">Instant Launch</span>
            </div>
          </div>
        </div>

        <div className="panel mode-card mode-dedicated">
          <div className="stack-sm">
            <ShieldCheck size={32} color="var(--r3e-cyan)" />
            <h2 style={{ fontSize: "1.8rem", margin: "1rem 0" }}>Dedicated Contract</h2>
            <p style={{ color: "var(--text-muted)", lineHeight: 1.6 }}>
              Deploy a dedicated NFT contract for complete ownership and isolation. Customize your contract hash and manage everything independently.
            </p>
            <div className="chip-row" style={{ marginTop: "1rem" }}>
              <span className="chip chip-info">10 GAS Fee</span>
              <span className="chip">Full Isolation</span>
            </div>
          </div>
        </div>
      </section>

      <FeaturedCollections 
        collections={featuredCollections} 
        previews={previewsByCollection} 
        loading={loading} 
      />
    </div>
  );
}
