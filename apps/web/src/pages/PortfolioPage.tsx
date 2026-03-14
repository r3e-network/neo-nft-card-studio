import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { FolderOpen, ImageOff, Loader2, Settings, Wallet, Copy, Check, Share2, Twitter } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useWallet } from "../hooks/useWallet";
import { fetchCollections, fetchMarketListings } from "../lib/api";
import { toUserErrorMessage } from "../lib/errors";
import { isZeroUInt160Hash, parseGasAmountToInteger, shortHash } from "../lib/marketplace";
import { getNftClientForHash, getPlatformClient } from "../lib/platformClient";
import { useRuntimeContractDialect } from "../lib/runtime-dialect";
import type { CollectionDto, MarketListingDto, TokenDto } from "../lib/types";

import { NFTGrid } from "../components/nft/NFTGrid";
import { StatusMessage } from "../components/common/StatusMessage";

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
  const reloadTimerRef = useRef<number | null>(null);

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
      const [ownedCollections, collected] = await Promise.all([
        fetchCollections(wallet.address),
        fetchMarketListings({ owner: wallet.address, limit: 500 }),
      ]);

      setCreatedCollections(ownedCollections);
      setCollectedListings(collected.filter((entry) => entry.token.burned !== 1));
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
    return () => {
      if (reloadTimerRef.current !== null) {
        window.clearTimeout(reloadTimerRef.current);
      }
    };
  }, [reloadPortfolio, wallet.network?.network, wallet.network?.magic]);

  const scheduleReloadPortfolio = useCallback((delayMs = 5000) => {
    if (reloadTimerRef.current !== null) {
      window.clearTimeout(reloadTimerRef.current);
    }

    reloadTimerRef.current = window.setTimeout(() => {
      reloadTimerRef.current = null;
      void reloadPortfolio();
    }, delayMs);
  }, [reloadPortfolio]);

  const onListToken = async (token: TokenDto) => {
    const listing = collectedListings.find(l => l.token.tokenId === token.tokenId);
    if (!listing) return;

    let price: string;
    try {
      price = parseGasAmountToInteger(listPriceByTokenId[token.tokenId] ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid price");
      return;
    }

    setActionTokenId(token.tokenId);
    setError("");
    setMessage("");

    try {
      await wallet.sync();
      const client = getCollectionClient(listing.collection);
      const txid = await wallet.invoke(client.buildListTokenForSaleInvoke({ tokenId: token.tokenId, price }));
      setMessage(`Listing submitted: ${txid}`);
      setCollectedListings((prev) => prev.map((entry) => {
        if (entry.token.tokenId !== token.tokenId) {
          return entry;
        }

        return {
          ...entry,
          sale: {
            ...entry.sale,
            listed: true,
            seller: wallet.address ?? entry.sale.seller,
            price,
            listedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        };
      }));
      scheduleReloadPortfolio();
    } catch (err) {
      setError(toUserErrorMessage(t, err));
    } finally {
      setActionTokenId("");
    }
  };

  const onCancelListing = async (token: TokenDto) => {
    const listing = collectedListings.find(l => l.token.tokenId === token.tokenId);
    if (!listing) return;

    setActionTokenId(token.tokenId);
    setError("");
    setMessage("");

    try {
      await wallet.sync();
      const client = getCollectionClient(listing.collection);
      const txid = await wallet.invoke(client.buildCancelTokenSaleInvoke({ tokenId: token.tokenId }));
      setMessage(`Listing canceled: ${txid}`);
      setCollectedListings((prev) => prev.map((entry) => {
        if (entry.token.tokenId !== token.tokenId) {
          return entry;
        }

        return {
          ...entry,
          sale: {
            ...entry.sale,
            listed: false,
            seller: "",
            price: "0",
            listedAt: "",
            updatedAt: new Date().toISOString(),
          },
        };
      }));
      scheduleReloadPortfolio();
    } catch (err) {
      setError(toUserErrorMessage(t, err));
    } finally {
      setActionTokenId("");
    }
  };

  const copyAddress = () => {
    if (wallet.address) {
      void navigator.clipboard.writeText(wallet.address)
        .then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        })
        .catch(() => {
          setError("Failed to copy wallet address.");
        });
    }
  };

  const collectedTokens = useMemo(() => collectedListings.map(l => l.token), [collectedListings]);
  const collectedSalesMap = useMemo(() => 
    Object.fromEntries(collectedListings.map(l => [l.token.tokenId, {
      listed: l.sale.listed,
      seller: l.sale.seller,
      price: l.sale.price,
      listedAt: l.sale.listedAt
    }])), 
    [collectedListings]
  );
  const collectionsMap = useMemo(() => 
    Object.fromEntries(collectedListings.map(l => [l.collection.collectionId, l.collection])),
    [collectedListings]
  );

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
          border: "6px solid var(--bg-main)", 
          background: "#1c2638",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
          zIndex: 10
        }}>
          <div style={{ width: "100%", height: "100%", background: "linear-gradient(45deg, #2081E2, var(--neo-green))" }}></div>
        </div>
      </div>

      <div style={{ padding: "85px 40px 40px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div className="stack-sm">
            <h1 style={{ fontSize: "2rem", fontWeight: 800, margin: 0 }}>Connected Wallet</h1>
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
                  color: "var(--text-muted)",
                  fontSize: "0.9rem",
                  fontWeight: 600
                }}
              >
                <span style={{ color: "#fff" }}>{shortHash(wallet.address)}</span>
                {copied ? <Check size={14} color="var(--neo-green)" /> : <Copy size={14} />}
              </div>
              <span style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>Neo N3 wallet profile</span>
            </div>
          </div>

          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button className="btn btn-secondary" style={{ borderRadius: "12px", padding: "0.6rem" }}><Share2 size={20} /></button>
            <button className="btn btn-secondary" style={{ borderRadius: "12px", padding: "0.6rem" }}><Twitter size={20} /></button>
            <button className="btn btn-secondary" style={{ borderRadius: "12px", padding: "0.6rem" }}><Settings size={20} /></button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: "2rem", borderBottom: "1px solid var(--glass-border)", margin: "2.5rem 0" }}>
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
                color: tab === t.id ? "var(--text-main)" : "var(--text-muted)",
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
                {[1, 2, 3, 4].map(i => <div key={i} className="panel skeleton" style={{ height: "400px" }}></div>)}
              </div>
            ) : collectedListings.length === 0 ? (
              <div className="panel" style={{ textAlign: "center", padding: "5rem" }}>
                <ImageOff size={48} color="var(--text-muted)" style={{ marginBottom: "1rem" }} />
                <h3>No items found</h3>
                <p className="hint">Explore the marketplace to find your first NFT.</p>
                <Link className="btn" to="/explore" style={{ marginTop: "1.5rem", background: "#2081E2" }}>Explore Marketplace</Link>
              </div>
            ) : (
              <NFTGrid
                tokens={collectedTokens}
                collections={collectionsMap}
                salesByTokenId={collectedSalesMap}
                listPriceByTokenId={listPriceByTokenId}
                onListPriceChange={(id, val) => setListPriceByTokenId(prev => ({ ...prev, [id]: val }))}
                onList={onListToken}
                onCancel={onCancelListing}
                onBuy={() => {}} // Buy not usually from portfolio
                actionTokenId={actionTokenId}
                isCsharp={isCsharp}
                walletAddress={wallet.address}
              />
            )}
          </div>
        )}

        {tab === "created" && (
          <div className="stack-md">
            {loading ? (
              <div style={{ display: "grid", gap: "1.5rem", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
                {[1, 2].map(i => <div key={i} className="panel skeleton" style={{ height: "250px" }}></div>)}
              </div>
            ) : createdCollections.length === 0 ? (
              <div className="panel" style={{ textAlign: "center", padding: "5rem" }}>
                <FolderOpen size={48} color="var(--text-muted)" style={{ marginBottom: "1rem" }} />
                <h3>No collections created</h3>
                <p className="hint">Start your journey by creating your first NFT collection.</p>
                <Link className="btn" to="/collections/new" style={{ marginTop: "1.5rem", background: "#2081E2" }}>Create Collection</Link>
              </div>
            ) : (
              <div style={{ display: "grid", gap: "1.5rem", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
                {createdCollections.map((collection) => {
                  const dedicatedHash = resolveCollectionContractHash(collection);

                  return (
                    <div className="panel nft-card" key={collection.collectionId} style={{ padding: 0, overflow: "hidden" }}>
                      <div style={{ height: "120px", background: "linear-gradient(45deg, #121822, #1c2638)", position: "relative" }}>
                        <div style={{ position: "absolute", bottom: "-20px", left: "20px", width: "60px", height: "60px", borderRadius: "10px", background: "linear-gradient(135deg, #2081E2, var(--neo-green))", border: "3px solid var(--bg-main)" }}></div>
                      </div>
                      <div style={{ padding: "30px 1.5rem 1.5rem" }}>
                        <h3 style={{ margin: 0 }}>{collection.name}</h3>
                        <div style={{ fontSize: "0.9rem", color: "var(--text-muted)", marginBottom: "1rem" }}>{collection.symbol}</div>
                        
                        <div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem" }}>
                          <div>
                            <div style={{ fontWeight: 700 }}>{collection.minted}</div>
                            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Items</div>
                          </div>
                          <div>
                            <div style={{ fontWeight: 700 }}>{(collection.royaltyBps / 100).toFixed(1)}%</div>
                            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Royalty</div>
                          </div>
                          <div>
                            <div style={{ fontWeight: 700 }}>{dedicatedHash ? "Isolated" : "Shared"}</div>
                            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Mode</div>
                          </div>
                        </div>

                        <div style={{ display: "flex", gap: "0.5rem" }}>
                          <Link className="btn" to={`/collections/${collection.collectionId}`} style={{ flex: 1, padding: "0.6rem", fontSize: "0.9rem", background: "#2081E2" }}>Manage</Link>
                          <Link className="btn btn-secondary" to={`/mint?collectionId=${encodeURIComponent(collection.collectionId)}`} style={{ flex: 1, padding: "0.6rem", fontSize: "0.9rem" }}>Mint Item</Link>
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
            <Loader2 size={48} color="var(--text-muted)" className="animate-spin" style={{ marginBottom: "1rem" }} />
            <h3>Activity tracking coming soon</h3>
            <p className="hint">We are working on integrating historical data for your wallet.</p>
          </div>
        )}
      </div>

      <StatusMessage 
        message={message} 
        type="success" 
        onClose={() => setMessage("")} 
      />
      <StatusMessage 
        message={error} 
        type="error" 
        onClose={() => setError("")} 
      />
    </div>
  );
}
