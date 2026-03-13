import { Link } from "react-router-dom";
import { ArrowRight, Sparkles } from "lucide-react";
import type { CollectionDto } from "../../lib/types";
import { buildNftFallbackImage, type CollectionPreview } from "../../lib/nft-media";
import { shortHash } from "../../lib/marketplace";

interface FeaturedCollectionsProps {
  collections: CollectionDto[];
  previews: Record<string, CollectionPreview>;
  loading: boolean;
}

export function FeaturedCollections({ collections, previews, loading }: FeaturedCollectionsProps) {
  return (
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
            <div key={i} className="panel skeleton" style={{ height: "380px", background: "rgba(255,255,255,0.05)" }}></div>
          ))}
        </div>
      ) : collections.length === 0 ? (
        <div className="panel" style={{ textAlign: "center", padding: "4rem" }}>
          <Sparkles size={48} color="var(--text-muted)" style={{ marginBottom: "1rem" }} />
          <h3>No collections found</h3>
          <p className="hint">Be the first to create an amazing NFT collection on Neo N3!</p>
          <Link className="btn" to="/collections/new" style={{ marginTop: "1.5rem" }}>Create Collection</Link>
        </div>
      ) : (
        <div style={{ display: "grid", gap: "1.5rem", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
          {collections.map((collection) => {
            const preview = previews[collection.collectionId];
            const fallbackImage = buildNftFallbackImage(collection.name, collection.collectionId, collection.name);
            const imageSrc = preview?.imageUri || fallbackImage;
            const tokenLabel = preview?.tokenName || `${collection.name} #${collection.collectionId}`;

            return (
              <Link
                key={collection.collectionId}
                to={`/collections/${collection.collectionId}`}
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <div className="panel nft-card" style={{ padding: 0, overflow: "hidden" }}>
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
                    <div style={{ color: "var(--text-muted)", fontSize: "0.9rem", margin: "0.25rem 0 1rem" }}>by {shortHash(collection.owner)}</div>
                    <div className="chip-row">
                      <span className="chip" style={{ fontSize: "0.75rem" }}>{collection.minted} items</span>
                      <span className="chip" style={{ fontSize: "0.75rem" }}>{(collection.royaltyBps / 100).toFixed(1)}% royalty</span>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
