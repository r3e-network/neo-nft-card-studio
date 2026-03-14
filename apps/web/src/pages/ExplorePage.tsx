import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ImageOff, Loader2, Search, ShoppingCart, Tag, Filter } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useWallet } from "../hooks/useWallet";
import { fetchMarketListings } from "../lib/api";
import { toUserErrorMessage } from "../lib/errors";
import { formatGasAmount, isZeroUInt160Hash, shortHash, tokenSerial } from "../lib/marketplace";
import { buildNftFallbackImage, parseTokenProperties, pickTokenMediaUri } from "../lib/nft-media";
import { mergePendingMarketState, setPendingMarketState } from "../lib/pending-market";
import { getNftClientForHash, getPlatformClient } from "../lib/platformClient";
import { useRuntimeContractDialect } from "../lib/runtime-dialect";
import type { CollectionDto, MarketListingDto, TokenDto } from "../lib/types";

function resolveCollectionContractHash(collection: CollectionDto): string | null {
  if (!collection.contractHash) {
    return null;
  }

  const trimmed = collection.contractHash.trim();
  if (!trimmed || isZeroUInt160Hash(trimmed)) {
    return null;
  }

  return trimmed;
}

function getCollectionClient(collection: CollectionDto) {
  const dedicatedHash = resolveCollectionContractHash(collection);
  return dedicatedHash ? getNftClientForHash(dedicatedHash) : getPlatformClient();
}

export function ExplorePage() {
  const wallet = useWallet();
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const contractDialect = useRuntimeContractDialect();

  const [cards, setCards] = useState<MarketListingDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionTokenId, setActionTokenId] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const reloadTimerRef = useRef<number | null>(null);

  const query = searchParams.get("search") || "";
  const isCsharp = contractDialect === "csharp";

  const reloadMarket = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const listings = await fetchMarketListings({ limit: 500 });
      setCards(mergePendingMarketState(listings).filter((entry) => entry.token.burned !== 1));
    } catch (err) {
      setCards([]);
      setError(toUserErrorMessage(t, err));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void reloadMarket();
    return () => {
      if (reloadTimerRef.current !== null) {
        window.clearTimeout(reloadTimerRef.current);
      }
    };
  }, [reloadMarket, wallet.network?.network, wallet.network?.magic]);

  const scheduleReloadMarket = useCallback((delayMs = 5000) => {
    if (reloadTimerRef.current !== null) {
      window.clearTimeout(reloadTimerRef.current);
    }

    reloadTimerRef.current = window.setTimeout(() => {
      reloadTimerRef.current = null;
      void reloadMarket();
    }, delayMs);
  }, [reloadMarket]);

  const visibleCards = useMemo(() => {
    const q = query.trim().toLowerCase();

    let filtered = cards.filter((card) => {
      if (activeTab === "listed" && !card.sale.listed) return false;
      
      if (!q) {
        return true;
      }

      const properties = parseTokenProperties(card.token.propertiesJson);
      const tokenName = typeof properties.name === "string" ? properties.name.toLowerCase() : "";

      return (
        card.collection.name.toLowerCase().includes(q)
        || card.collection.symbol.toLowerCase().includes(q)
        || card.collection.collectionId.toLowerCase().includes(q)
        || card.token.tokenId.toLowerCase().includes(q)
        || card.token.owner.toLowerCase().includes(q)
        || tokenName.includes(q)
      );
    });

    return filtered.sort((a, b) => {
      const listedDiff = Number(b.sale.listed) - Number(a.sale.listed);
      if (listedDiff !== 0) {
        return listedDiff;
      }

      const aListedAt = Number(new Date(a.sale.listedAt || 0));
      const bListedAt = Number(new Date(b.sale.listedAt || 0));
      if (aListedAt !== bListedAt) {
        return bListedAt - aListedAt;
      }

      const aMintedAt = Number(new Date(a.token.mintedAt || 0));
      const bMintedAt = Number(new Date(b.token.mintedAt || 0));
      return bMintedAt - aMintedAt;
    });
  }, [cards, query, activeTab]);

  const onBuyToken = async (card: MarketListingDto) => {
    if (!isCsharp || !card.sale.listed) {
      return;
    }

    setActionTokenId(card.token.tokenId);
    setError("");

    try {
      await wallet.sync();
      const client = getCollectionClient(card.collection);
      await wallet.invoke(client.buildBuyTokenInvoke({ tokenId: card.token.tokenId }));
      const buyerAddress = wallet.address;
      if (buyerAddress) {
        const nowIso = new Date().toISOString();
        setPendingMarketState({
          tokenId: card.token.tokenId,
          owner: buyerAddress,
          sale: {
            listed: false,
            seller: "",
            price: "0",
            listedAt: "",
            updatedAt: nowIso,
          },
        });
        setCards((prev) => prev.map((entry) => {
          if (entry.token.tokenId !== card.token.tokenId) {
            return entry;
          }

          return {
            ...entry,
            token: {
              ...entry.token,
              owner: buyerAddress,
            },
            sale: {
              ...entry.sale,
              listed: false,
              seller: "",
              price: "0",
              listedAt: "",
              updatedAt: nowIso,
            },
          };
        }));
      }
      scheduleReloadMarket();
    } catch (err) {
      setError(toUserErrorMessage(t, err));
    } finally {
      setActionTokenId("");
    }
  };

  return (
    <div className="stack-lg fade-in">
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "2.5rem", fontWeight: 700, margin: "0 0 1rem" }}>Explore Collections</h1>
        
        <div style={{ display: "flex", gap: "1rem", borderBottom: "1px solid rgba(255, 255, 255, 0.1)", marginBottom: "2rem" }}>
          {["all", "listed"].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                background: "none",
                border: "none",
                padding: "1rem 0.5rem",
                color: activeTab === tab ? "#fff" : "#8A939B",
                fontWeight: 600,
                fontSize: "1rem",
                cursor: "pointer",
                borderBottom: activeTab === tab ? "2px solid #2081E2" : "2px solid transparent",
                transition: "all 0.2s"
              }}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <button className="btn btn-secondary" style={{ display: "flex", alignItems: "center", gap: "0.5rem", borderRadius: "10px" }}>
              <Filter size={18} /> Filters
            </button>
            <span style={{ color: "#8A939B", fontWeight: 500 }}>{visibleCards.length} results</span>
          </div>
          
          <div style={{ display: "flex", gap: "0.5rem" }}>
            {query && (
              <span className="chip" style={{ borderRadius: "10px", padding: "0.5rem 1rem" }}>
                Search: {query} 
                <button 
                  onClick={() => setSearchParams({})} 
                  style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", marginLeft: "0.5rem", fontWeight: 800 }}
                >
                  ×
                </button>
              </span>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ display: "grid", gap: "1.5rem", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
          {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
            <div key={i} className="panel" style={{ height: "400px", background: "rgba(255,255,255,0.05)" }}></div>
          ))}
        </div>
      ) : visibleCards.length === 0 ? (
        <div className="panel" style={{ textAlign: "center", padding: "5rem" }}>
          <Search size={48} color="#8A939B" style={{ marginBottom: "1rem" }} />
          <h3>No items found for this search</h3>
          <p className="hint">Try to search for something else or clear the filters.</p>
          <button className="btn" onClick={() => setSearchParams({})} style={{ marginTop: "1.5rem" }}>Clear all</button>
        </div>
      ) : (
        <div style={{ display: "grid", gap: "1.5rem", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
          {visibleCards.map((card) => {
            const properties = parseTokenProperties(card.token.propertiesJson);
            const media = pickTokenMediaUri(card.token, properties);
            const tokenName =
              typeof properties.name === "string" && properties.name.trim().length > 0
                ? properties.name.trim()
                : `${card.collection.symbol} #${tokenSerial(card.token.tokenId)}`;
            const fallbackImage = buildNftFallbackImage(tokenName, card.token.tokenId, card.collection.name);
            const isOwner = wallet.address === card.token.owner;
            const isBuying = actionTokenId === card.token.tokenId;

            return (
              <div 
                className="panel" 
                key={card.token.tokenId} 
                style={{ padding: 0, overflow: "hidden", transition: "transform 0.2s" }}
                onMouseOver={(e) => e.currentTarget.style.transform = "translateY(-5px)"}
                onMouseOut={(e) => e.currentTarget.style.transform = "translateY(0)"}
              >
                <Link to={`/collections/${card.collection.collectionId}`} style={{ display: "block" }}>
                  <img
                    alt={tokenName}
                    onError={(event) => {
                      if (event.currentTarget.src !== fallbackImage) {
                        event.currentTarget.src = fallbackImage;
                      }
                    }}
                    src={media || fallbackImage}
                    style={{ width: "100%", height: "280px", objectFit: "cover" }}
                  />
                </Link>

                <div style={{ padding: "1.2rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
                    <div style={{ overflow: "hidden" }}>
                      <div style={{ fontSize: "0.75rem", color: "#8A939B", fontWeight: 600 }}>{card.collection.name}</div>
                      <div style={{ fontWeight: 700, fontSize: "1rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tokenName}</div>
                    </div>
                    {card.sale.listed && (
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: "0.75rem", color: "#8A939B", fontWeight: 600 }}>Price</div>
                        <div style={{ fontWeight: 700, color: "#fff" }}>{formatGasAmount(card.sale.price)} GAS</div>
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "1rem" }}>
                    <div style={{ fontSize: "0.8rem", color: "#8A939B" }}>
                      Owned by <span style={{ color: "#2081E2" }}>{shortHash(card.token.owner)}</span>
                    </div>
                    {isCsharp && card.sale.listed && !isOwner ? (
                      <button
                        className="btn"
                        disabled={isBuying || !wallet.address}
                        onClick={() => void onBuyToken(card)}
                        type="button"
                        style={{ padding: "0.5rem 1rem", fontSize: "0.85rem", background: "#2081E2" }}
                      >
                        {isBuying ? "..." : "Buy"}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {error ? <p className="error" style={{ position: "fixed", bottom: "2rem", right: "2rem", maxWidth: "400px", zIndex: 100 }}>{error}</p> : null}
    </div>
  );
}
