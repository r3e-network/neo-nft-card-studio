import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FolderOpen, ImageOff, Loader2, Settings, Tag, Wallet, Copy, Check, Share2, Twitter } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useWallet } from "../hooks/useWallet";
import { fetchCollections, fetchMarketListings } from "../lib/api";
import { toUserErrorMessage } from "../lib/errors";
import { formatGasAmount, isZeroUInt160Hash, parseGasAmountToInteger, shortHash, tokenSerial } from "../lib/marketplace";
import { buildNftFallbackImage, parseTokenProperties, pickTokenMediaUri } from "../lib/nft-media";
import { getNftClientForHash, getPlatformClient } from "../lib/platformClient";
import { useRuntimeContractDialect } from "../lib/runtime-dialect";
import type { CollectionDto, MarketListingDto, TokenDto } from "../lib/types";

type Tab = "collected" | "created" | "activity";

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

export function PortfolioPage() {
  const wallet = useWallet();
  const { t } = useTranslation();
  const contractDialect = useRuntimeContractDialect();

  const [tab, setTab] = useState<Tab>("collected");
  const [collectedListings, setCollectedListings] = useState<MarketListingDto[]>([]);
  const [createdCollections, setCreatedCollections] = useState<CollectionDto[]>([]);
  const [listPriceByTokenId, setListPriceByTokenId] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [actionTokenId, setActionTokenId] = useState("");
  const [copied, setCopied] = useState(false);

  const isCsharp = contractDialect === "csharp";

  const reloadPortfolio = useCallback(async () => {
    if (!wallet.address) {
      setCollectedListings([]);
      setCreatedCollections([]);
      return;
    }

    setLoading(true);
    setError("");

    try {
      // Try DB first
      const [ownedCollections, collected] = await Promise.all([
        fetchCollections(wallet.address),
        fetchMarketListings({ owner: wallet.address, limit: 500 }),
      ]);

      setCreatedCollections(ownedCollections);
      setCollectedListings(collected.filter((entry) => entry.token.burned !== 1));

      // Trigger a sync in background if DB is empty but we just minted something
      if (collected.length === 0) {
        void fetch("/api/sync?network=testnet", { method: "POST" }).catch(() => {});
      }
    } catch (err) {
      setError(toUserErrorMessage(t, err));
      setCollectedListings([]);
      setCreatedCollections([]);
    } finally {
      setLoading(false);
    }
  }, [t, wallet.address]);

  useEffect(() => {
    void reloadPortfolio();
  }, [reloadPortfolio, wallet.network?.network, wallet.network?.magic]);

  const onListToken = async (entry: MarketListingDto) => {
    let price: string;
    try {
      price = parseGasAmountToInteger(listPriceByTokenId[entry.token.tokenId] ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid price");
      return;
    }

    setActionTokenId(entry.token.tokenId);
    setError("");
    setMessage("");

    try {
      await wallet.sync();
      const client = getCollectionClient(entry.collection);
      const txid = await wallet.invoke(client.buildListTokenForSaleInvoke({ tokenId: entry.token.tokenId, price }));
      setMessage(`Listing submitted: ${txid}`);
      await reloadPortfolio();
    } catch (err) {
      setError(toUserErrorMessage(t, err));
    } finally {
      setActionTokenId("");
    }
  };

  const onCancelListing = async (entry: MarketListingDto) => {
    setActionTokenId(entry.token.tokenId);
    setError("");
    setMessage("");

    try {
      await wallet.sync();
      const client = getCollectionClient(entry.collection);
      const txid = await wallet.invoke(client.buildCancelTokenSaleInvoke({ tokenId: entry.token.tokenId }));
      setMessage(`Listing canceled: ${txid}`);
      await reloadPortfolio();
    } catch (err) {
      setError(toUserErrorMessage(t, err));
    } finally {
      setActionTokenId("");
    }
  };

  const copyAddress = () => {
    if (wallet.address) {
      navigator.clipboard.writeText(wallet.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!wallet.address) {
    return (
      <div className="flex-center" style={{ flexDirection: "column", gap: "1.5rem", minHeight: "60vh" }}>
        <Wallet color="#2081E2" size={64} />
        <h2 style={{ fontSize: "2rem", fontWeight: 800 }}>Wallet not connected</h2>
        <p className="hint" style={{ fontSize: "1.1rem" }}>Connect your wallet to see your items, collections and activity.</p>
        <button className="btn" onClick={() => void wallet.connect()} style={{ background: "#2081E2", padding: "1rem 2rem", borderRadius: "12px" }}>
          Connect Wallet
        </button>
      </div>
    );
  }

  return (
    <div className="fade-in" style={{ margin: "-1.4rem -1.2rem 0" }}>
      {/* Profile Header */}
      <div style={{ height: "260px", background: "linear-gradient(135deg, #121822, #1c2638, #2081E2)", position: "relative" }}>
        <div style={{ 
          position: "absolute", 
          bottom: "-65px", 
          left: "40px", 
          width: "130px", 
          height: "130px", 
          borderRadius: "50%", 
          border: "6px solid #04060A", 
          background: "#1c2638",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
          zIndex: 10
        }}>
          <div style={{ width: "100%", height: "100%", background: "linear-gradient(45deg, #2081E2, #00E599)" }}></div>
        </div>
      </div>

      <div style={{ padding: "85px 40px 40px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div className="stack-sm">
            <h1 style={{ fontSize: "2rem", fontWeight: 800, margin: 0 }}>Unnamed User</h1>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.5rem" }}>
              <div 
                onClick={copyAddress}
                style={{ 
                  display: "flex", 
                  alignItems: "center", 
                  gap: "0.5rem", 
                  padding: "0.4rem 0.8rem", 
                  background: "rgba(255,255,255,0.05)", 
                  borderRadius: "20px",
                  cursor: "pointer",
                  color: "#8A939B",
                  fontSize: "0.9rem",
                  fontWeight: 600
                }}
              >
                <span style={{ color: "#fff" }}>{shortHash(wallet.address)}</span>
                {copied ? <Check size={14} color="#00E599" /> : <Copy size={14} />}
              </div>
              <span style={{ color: "#8A939B", fontSize: "0.9rem" }}>Joined March 2026</span>
            </div>
          </div>

          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button className="btn btn-secondary" style={{ borderRadius: "12px", padding: "0.6rem" }}><Share2 size={20} /></button>
            <button className="btn btn-secondary" style={{ borderRadius: "12px", padding: "0.6rem" }}><Twitter size={20} /></button>
            <button className="btn btn-secondary" style={{ borderRadius: "12px", padding: "0.6rem" }}><Settings size={20} /></button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: "2rem", borderBottom: "1px solid rgba(255, 255, 255, 0.1)", margin: "2.5rem 0" }}>
          {[
            { id: "collected", label: "Collected", count: collectedListings.length },
            { id: "created", label: "Created", count: createdCollections.length },
            { id: "activity", label: "Activity", count: 0 }
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id as Tab)}
              style={{
                background: "none",
                border: "none",
                padding: "1rem 0",
                color: tab === t.id ? "#fff" : "#8A939B",
                fontWeight: 600,
                fontSize: "1rem",
                cursor: "pointer",
                borderBottom: tab === t.id ? "2px solid #2081E2" : "2px solid transparent",
                transition: "all 0.2s",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem"
              }}
            >
              {t.label} <span style={{ fontSize: "0.85rem", opacity: 0.6 }}>{t.count}</span>
            </button>
          ))}
        </div>

        {tab === "collected" && (
          <div className="stack-md">
            {loading ? (
              <div style={{ display: "grid", gap: "1.5rem", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
                {[1, 2, 3, 4].map(i => <div key={i} className="panel" style={{ height: "400px", background: "rgba(255,255,255,0.05)" }}></div>)}
              </div>
            ) : collectedListings.length === 0 ? (
              <div className="panel" style={{ textAlign: "center", padding: "5rem" }}>
                <ImageOff size={48} color="#8A939B" style={{ marginBottom: "1rem" }} />
                <h3>No items found</h3>
                <p className="hint">Explore the marketplace to find your first NFT.</p>
                <Link className="btn" to="/explore" style={{ marginTop: "1.5rem", background: "#2081E2" }}>Explore Marketplace</Link>
              </div>
            ) : (
              <div style={{ display: "grid", gap: "1.5rem", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
                {collectedListings.map((entry) => {
                  const properties = parseTokenProperties(entry.token.propertiesJson);
                  const media = pickTokenMediaUri(entry.token, properties);
                  const tokenName =
                    typeof properties.name === "string" && properties.name.trim().length > 0
                      ? properties.name.trim()
                      : `${entry.collection.symbol} #${tokenSerial(entry.token.tokenId)}`;
                  const fallbackImage = buildNftFallbackImage(tokenName, entry.token.tokenId, entry.collection.name);
                  const isActing = actionTokenId === entry.token.tokenId;

                  return (
                    <div className="panel" key={entry.token.tokenId} style={{ padding: 0, overflow: "hidden" }}>
                      <Link to={`/collections/${entry.collection.collectionId}`}>
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
                        <div style={{ fontSize: "0.75rem", color: "#8A939B", fontWeight: 600 }}>{entry.collection.name}</div>
                        <div style={{ fontWeight: 700, fontSize: "1rem", marginBottom: "1rem" }}>{tokenName}</div>

                        {entry.sale.listed ? (
                          <div style={{ marginBottom: "1rem" }}>
                            <div style={{ fontSize: "0.75rem", color: "#8A939B", fontWeight: 600 }}>Listed Price</div>
                            <div style={{ fontWeight: 700, fontSize: "1.1rem" }}>{formatGasAmount(entry.sale.price)} GAS</div>
                          </div>
                        ) : (
                          <div style={{ marginBottom: "1rem", color: "#8A939B", fontSize: "0.9rem" }}>Not listed</div>
                        )}

                        {isCsharp && (
                          <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "1rem" }}>
                            {entry.sale.listed ? (
                              <button
                                className="btn btn-secondary"
                                disabled={isActing}
                                onClick={() => void onCancelListing(entry)}
                                type="button"
                                style={{ width: "100%", borderRadius: "10px" }}
                              >
                                {isActing ? "..." : "Cancel Listing"}
                              </button>
                            ) : (
                              <div className="stack-xs">
                                <input
                                  onChange={(event) =>
                                    setListPriceByTokenId((prev) => ({ ...prev, [entry.token.tokenId]: event.target.value }))
                                  }
                                  placeholder="Price in GAS"
                                  value={listPriceByTokenId[entry.token.tokenId] ?? ""}
                                  style={{ height: "40px", marginBottom: "0.5rem" }}
                                />
                                <button className="btn" disabled={isActing} onClick={() => void onListToken(entry)} type="button" style={{ width: "100%", borderRadius: "10px", background: "#2081E2" }}>
                                  {isActing ? "..." : "List for Sale"}
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === "created" && (
          <div className="stack-md">
            {loading ? (
              <div style={{ display: "grid", gap: "1.5rem", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
                {[1, 2].map(i => <div key={i} className="panel" style={{ height: "250px", background: "rgba(255,255,255,0.05)" }}></div>)}
              </div>
            ) : createdCollections.length === 0 ? (
              <div className="panel" style={{ textAlign: "center", padding: "5rem" }}>
                <FolderOpen size={48} color="#8A939B" style={{ marginBottom: "1rem" }} />
                <h3>No collections created</h3>
                <p className="hint">Start your journey by creating your first NFT collection.</p>
                <Link className="btn" to="/collections/new" style={{ marginTop: "1.5rem", background: "#2081E2" }}>Create Collection</Link>
              </div>
            ) : (
              <div style={{ display: "grid", gap: "1.5rem", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
                {createdCollections.map((collection) => {
                  const dedicatedHash = resolveCollectionContractHash(collection);

                  return (
                    <div className="panel" key={collection.collectionId} style={{ padding: 0, overflow: "hidden" }}>
                      <div style={{ height: "120px", background: "linear-gradient(45deg, #121822, #1c2638)", position: "relative" }}>
                        <div style={{ position: "absolute", bottom: "-20px", left: "20px", width: "60px", height: "60px", borderRadius: "10px", background: "linear-gradient(135deg, #2081E2, #00E599)", border: "3px solid #04060A" }}></div>
                      </div>
                      <div style={{ padding: "30px 1.5rem 1.5rem" }}>
                        <h3 style={{ margin: 0 }}>{collection.name}</h3>
                        <div style={{ fontSize: "0.9rem", color: "#8A939B", marginBottom: "1rem" }}>{collection.symbol}</div>
                        
                        <div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem" }}>
                          <div>
                            <div style={{ fontWeight: 700 }}>{collection.minted}</div>
                            <div style={{ fontSize: "0.75rem", color: "#8A939B" }}>Items</div>
                          </div>
                          <div>
                            <div style={{ fontWeight: 700 }}>{(collection.royaltyBps / 100).toFixed(1)}%</div>
                            <div style={{ fontSize: "0.75rem", color: "#8A939B" }}>Royalty</div>
                          </div>
                          <div>
                            <div style={{ fontWeight: 700 }}>{dedicatedHash ? "Isolated" : "Shared"}</div>
                            <div style={{ fontSize: "0.75rem", color: "#8A939B" }}>Mode</div>
                          </div>
                        </div>

                        <div style={{ display: "flex", gap: "0.5rem" }}>
                          <Link className="btn" to={`/collections/${collection.collectionId}`} style={{ flex: 1, padding: "0.6rem", fontSize: "0.9rem", background: "#2081E2" }}>Manage</Link>
                          <Link className="btn btn-secondary" to="/mint" style={{ flex: 1, padding: "0.6rem", fontSize: "0.9rem" }}>Mint Item</Link>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === "activity" && (
          <div className="panel" style={{ textAlign: "center", padding: "5rem" }}>
            <Loader2 size={48} color="#8A939B" className="animate-spin" style={{ marginBottom: "1rem" }} />
            <h3>Activity tracking coming soon</h3>
            <p className="hint">We are integrating historical data for your wallet.</p>
          </div>
        )}
      </div>

      {message ? <p className="success" style={{ position: "fixed", bottom: "2rem", right: "2rem", maxWidth: "400px", zIndex: 100 }}>{message}</p> : null}
      {error ? <p className="error" style={{ position: "fixed", bottom: "2rem", right: "2rem", maxWidth: "400px", zIndex: 100 }}>{error}</p> : null}
    </div>
  );
}
