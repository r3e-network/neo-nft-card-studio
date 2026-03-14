import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ExternalLink, Globe, Loader2, Share2, Twitter } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useWallet } from "../hooks/useWallet";
import { fetchCollection, fetchCollectionTokens, fetchGhostMarketMeta, fetchMarketListings, uploadToNeoFs } from "../lib/api";
import { toUserErrorMessage } from "../lib/errors";
import {
  isZeroUInt160Hash,
  parseGasAmountToInteger,
  shortHash,
  type TokenSaleState,
} from "../lib/marketplace";
import { setPendingMarketState } from "../lib/pending-market";
import { getNftClientForHash, getPlatformClient } from "../lib/platformClient";
import { useRuntimeContractDialect } from "../lib/runtime-dialect";
import type { CollectionDto, GhostMarketMetaDto, TokenDto } from "../lib/types";

import { NFTGrid } from "../components/nft/NFTGrid";
import { StatusMessage } from "../components/common/StatusMessage";

interface MintFormState {
  to: string;
  name: string;
  description: string;
  file: File | null;
}

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

function buildMintProperties(name: string, description: string, imageUri: string): string {
  return JSON.stringify({
    name: name.trim(),
    description: description.trim(),
    image: imageUri,
    attributes: [],
  });
}

export function CollectionDetailPage() {
  const { collectionId = "" } = useParams();
  const wallet = useWallet();
  const { t } = useTranslation();
  const contractDialect = useRuntimeContractDialect();

  const [collection, setCollection] = useState<CollectionDto | null>(null);
  const [tokens, setTokens] = useState<TokenDto[]>([]);
  const [ghostMarket, setGhostMarket] = useState<GhostMarketMetaDto | null>(null);
  const [salesByTokenId, setSalesByTokenId] = useState<Record<string, TokenSaleState>>({});
  const [listPriceByTokenId, setListPriceByTokenId] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadingSales, setLoadingSales] = useState(false);
  const [actionTokenId, setActionTokenId] = useState("");
  const [submittingMint, setSubmittingMint] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState("items");
  const [mintForm, setMintForm] = useState<MintFormState>({
    to: wallet.address ?? "",
    name: "",
    description: "",
    file: null,
  });
  const requestSequenceRef = useRef(0);
  const reloadTimerRef = useRef<number | null>(null);

  const isCsharp = contractDialect === "csharp";
  const isDedicatedCollection = collection ? resolveCollectionContractHash(collection) !== null : false;
  const ownerCount = useMemo(() => new Set(tokens.map((token) => token.owner).filter((owner) => owner.length > 0)).size, [tokens]);

  useEffect(() => {
    setMintForm((prev) => ({ ...prev, to: wallet.address ?? "" }));
  }, [wallet.address]);

  const reloadSales = useCallback(async (
    nextCollection: CollectionDto | null,
    nextTokens: TokenDto[],
    requestId = requestSequenceRef.current,
  ) => {
    if (!isCsharp || !nextCollection || nextTokens.length === 0) {
      if (requestId === requestSequenceRef.current) {
        setSalesByTokenId({});
      }
      return;
    }

    setLoadingSales(true);
    try {
      const listings = await fetchMarketListings({
        collectionId: nextCollection.collectionId,
        limit: 5000,
      });

      const byTokenId: Record<string, TokenSaleState> = Object.fromEntries(
        nextTokens.map((token) => [
          token.tokenId,
          {
            listed: false,
            seller: "",
            price: "0",
            listedAt: "",
          },
        ]),
      );

      for (const listing of listings) {
        if (!byTokenId[listing.token.tokenId]) {
          continue;
        }

        byTokenId[listing.token.tokenId] = {
          listed: Boolean(listing.sale.listed),
          seller: listing.sale.seller ?? "",
          price: listing.sale.price ?? "0",
          listedAt: listing.sale.listedAt ?? "",
        };
      }

      if (requestId === requestSequenceRef.current) {
        setSalesByTokenId(byTokenId);
      }
    } catch {
      if (requestId === requestSequenceRef.current) {
        setSalesByTokenId({});
      }
    } finally {
      if (requestId === requestSequenceRef.current) {
        setLoadingSales(false);
      }
    }
  }, [isCsharp]);

  const reloadCollection = useCallback(async () => {
    const requestId = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestId;

    if (!collectionId) {
      setLoading(false);
      setCollection(null);
      setTokens([]);
      setGhostMarket(null);
      setSalesByTokenId({});
      return;
    }

    setLoading(true);
    setError("");

    try {
      const fetchedCollection = await fetchCollection(collectionId);
      const [fetchedTokens, fetchedGhostMeta] = await Promise.all([
        fetchCollectionTokens(collectionId),
        fetchGhostMarketMeta(resolveCollectionContractHash(fetchedCollection) ?? undefined).catch(() => null),
      ]);

      if (requestId !== requestSequenceRef.current) {
        return;
      }

      setCollection(fetchedCollection);
      setTokens(fetchedTokens);
      setGhostMarket(fetchedGhostMeta);

      if (isCsharp) {
        await reloadSales(fetchedCollection, fetchedTokens, requestId);
      } else {
        setSalesByTokenId({});
      }
    } catch (err) {
      if (requestId !== requestSequenceRef.current) {
        return;
      }

      setError(toUserErrorMessage(t, err));
      setCollection(null);
      setTokens([]);
      setGhostMarket(null);
      setSalesByTokenId({});
    } finally {
      if (requestId === requestSequenceRef.current) {
        setLoading(false);
      }
    }
  }, [collectionId, isCsharp, reloadSales, t]);

  useEffect(() => {
    void reloadCollection();

    return () => {
      if (reloadTimerRef.current !== null) {
        window.clearTimeout(reloadTimerRef.current);
      }
      requestSequenceRef.current += 1;
    };
  }, [reloadCollection, wallet.network?.network, wallet.network?.magic]);

  const scheduleReloadCollection = useCallback((delayMs = 5000) => {
    if (reloadTimerRef.current !== null) {
      window.clearTimeout(reloadTimerRef.current);
    }

    reloadTimerRef.current = window.setTimeout(() => {
      reloadTimerRef.current = null;
      void reloadCollection();
    }, delayMs);
  }, [reloadCollection]);

  const onMintToken = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!wallet.address) {
      setError("Connect wallet first.");
      return;
    }

    if (!collection) {
      setError("Collection not available.");
      return;
    }

    if (!mintForm.to.trim()) {
      setError("Recipient address is required.");
      return;
    }

    if (!mintForm.file) {
      setError("Upload media file before mint.");
      return;
    }

    if (!isCsharp) {
      setError("Mint from collection page currently supports C# contract mode only.");
      return;
    }

    setSubmittingMint(true);
    setError("");
    setMessage("");

    try {
      await wallet.sync();

      const upload = await uploadToNeoFs(mintForm.file);
      const tokenUri = upload.uri;
      const propertiesJson = buildMintProperties(mintForm.name || `#${collection.minted}`, mintForm.description, tokenUri);

      const client = getCollectionClient(collection);
      const txid = await wallet.invoke(
        client.buildMintInvoke({
          collectionId: collection.collectionId,
          to: mintForm.to.trim(),
          tokenUri,
          propertiesJson,
        }),
      );

      setMessage(`Mint submitted: ${txid}`);
      setMintForm({ to: wallet.address ?? "", name: "", description: "", file: null });
      scheduleReloadCollection();
    } catch (err) {
      setError(toUserErrorMessage(t, err));
    } finally {
      setSubmittingMint(false);
    }
  };

  const onListToken = async (token: TokenDto) => {
    if (!collection) {
      return;
    }

    const input = listPriceByTokenId[token.tokenId] ?? "";
    let price: string;

    try {
      price = parseGasAmountToInteger(input);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid price");
      return;
    }

    setActionTokenId(token.tokenId);
    setError("");
    setMessage("");

    try {
      await wallet.sync();
      const client = getCollectionClient(collection);
      const txid = await wallet.invoke(client.buildListTokenForSaleInvoke({ tokenId: token.tokenId, price }));
      setMessage(`Listing submitted: ${txid}`);
      const nowIso = new Date().toISOString();
      setPendingMarketState({
        tokenId: token.tokenId,
        owner: wallet.address ?? token.owner,
        sale: {
          listed: true,
          seller: wallet.address ?? token.owner,
          price,
          listedAt: nowIso,
          updatedAt: nowIso,
        },
      });
      setSalesByTokenId((prev) => ({
        ...prev,
        [token.tokenId]: {
          listed: true,
          seller: wallet.address ?? token.owner,
          price,
          listedAt: nowIso,
        },
      }));
      scheduleReloadCollection();
    } catch (err) {
      setError(toUserErrorMessage(t, err));
    } finally {
      setActionTokenId("");
    }
  };

  const onCancelListing = async (token: TokenDto) => {
    if (!collection) {
      return;
    }

    setActionTokenId(token.tokenId);
    setError("");
    setMessage("");

    try {
      await wallet.sync();
      const client = getCollectionClient(collection);
      const txid = await wallet.invoke(client.buildCancelTokenSaleInvoke({ tokenId: token.tokenId }));
      setMessage(`Listing canceled: ${txid}`);
      setPendingMarketState({
        tokenId: token.tokenId,
        owner: token.owner,
        sale: {
          listed: false,
          seller: "",
          price: "0",
          listedAt: "",
          updatedAt: new Date().toISOString(),
        },
      });
      setSalesByTokenId((prev) => ({
        ...prev,
        [token.tokenId]: {
          listed: false,
          seller: "",
          price: "0",
          listedAt: "",
        },
      }));
      scheduleReloadCollection();
    } catch (err) {
      setError(toUserErrorMessage(t, err));
    } finally {
      setActionTokenId("");
    }
  };

  const onBuyToken = async (token: TokenDto) => {
    if (!collection) {
      return;
    }

    setActionTokenId(token.tokenId);
    setError("");
    setMessage("");

    try {
      await wallet.sync();
      const client = getCollectionClient(collection);
      const txid = await wallet.invoke(client.buildBuyTokenInvoke({ tokenId: token.tokenId }));
      setMessage(`Purchase submitted: ${txid}`);
      const buyerAddress = wallet.address;
      if (buyerAddress) {
        const nowIso = new Date().toISOString();
        setPendingMarketState({
          tokenId: token.tokenId,
          owner: buyerAddress,
          sale: {
            listed: false,
            seller: "",
            price: "0",
            listedAt: "",
            updatedAt: nowIso,
          },
        });
        setTokens((prev) => prev.map((entry) => (
          entry.tokenId === token.tokenId
            ? {
                ...entry,
                owner: buyerAddress,
              }
            : entry
        )));
      }
      setSalesByTokenId((prev) => ({
        ...prev,
        [token.tokenId]: {
          listed: false,
          seller: "",
          price: "0",
          listedAt: "",
        },
      }));
      scheduleReloadCollection();
    } catch (err) {
      setError(toUserErrorMessage(t, err));
    } finally {
      setActionTokenId("");
    }
  };

  if (loading) {
    return (
      <div className="flex-center" style={{ minHeight: "60vh" }}>
        <Loader2 className="animate-spin" size={48} color="#2081E2" />
      </div>
    );
  }

  if (!collection) {
    return (
      <section className="panel" style={{ textAlign: "center", padding: "5rem" }}>
        <h2>Collection not found</h2>
        <p className="hint" style={{ marginBottom: "2rem" }}>{error || "The collection does not exist on current network."}</p>
        <Link className="btn" to="/explore">
          Back to Explore
        </Link>
      </section>
    );
  }

  const collectionsMap = { [collection.collectionId]: collection };

  return (
    <div className="fade-in" style={{ margin: "-1.4rem -1.2rem 0" }}>
      {/* Banner Section */}
      <div style={{ height: "300px", background: "linear-gradient(45deg, #121822, #1c2638)", position: "relative" }}>
        <div style={{ 
          position: "absolute", 
          bottom: "-80px", 
          left: "40px", 
          width: "160px", 
          height: "160px", 
          borderRadius: "16px", 
          border: "6px solid var(--bg-main)", 
          background: "linear-gradient(135deg, #2081E2, var(--neo-green))",
          boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
          zIndex: 10
        }}></div>
      </div>

      <div style={{ padding: "100px 40px 40px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div className="stack-sm">
            <h1 style={{ fontSize: "2.5rem", fontWeight: 700, margin: 0 }}>{collection.name}</h1>
            <div style={{ display: "flex", alignItems: "center", gap: "1rem", color: "var(--text-muted)", fontWeight: 500 }}>
              <span>By <span style={{ color: "#2081E2" }}>{shortHash(collection.owner)}</span></span>
              <span>·</span>
              <span>{collection.symbol}</span>
            </div>
          </div>

          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button className="btn btn-secondary" style={{ borderRadius: "12px", padding: "0.6rem" }}><Share2 size={20} /></button>
            <button className="btn btn-secondary" style={{ borderRadius: "12px", padding: "0.6rem" }}><Twitter size={20} /></button>
            <button className="btn btn-secondary" style={{ borderRadius: "12px", padding: "0.6rem" }}><Globe size={20} /></button>
            {ghostMarket?.enabled && (
              <a className="btn btn-secondary" href={ghostMarket.contractSearchUrl} rel="noreferrer" target="_blank" style={{ borderRadius: "12px", padding: "0.6rem" }}>
                <ExternalLink size={20} />
              </a>
            )}
          </div>
        </div>

        {/* Stats Grid */}
        <div style={{ display: "flex", gap: "2rem", margin: "2rem 0" }}>
          <div>
            <div style={{ fontSize: "1.2rem", fontWeight: 700 }}>{collection.minted}</div>
            <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Items</div>
          </div>
          <div>
            <div style={{ fontSize: "1.2rem", fontWeight: 700 }}>{ownerCount}</div>
            <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Owners</div>
          </div>
          <div>
            <div style={{ fontSize: "1.2rem", fontWeight: 700 }}>{(collection.royaltyBps / 100).toFixed(1)}%</div>
            <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Creator Fee</div>
          </div>
          <div>
            <div style={{ fontSize: "1.2rem", fontWeight: 700 }}>{isDedicatedCollection ? "Isolated" : "Shared"}</div>
            <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Deployment</div>
          </div>
        </div>

        <p style={{ maxWidth: "800px", lineHeight: 1.6, color: "var(--text-muted)", fontSize: "1.1rem" }}>
          {collection.description || "No description provided for this collection."}
        </p>

        {/* Tabs */}
        <div style={{ display: "flex", gap: "2rem", borderBottom: "1px solid var(--glass-border)", margin: "2rem 0" }}>
          {["items", "mint", "activity"].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                background: "none",
                border: "none",
                padding: "1rem 0",
                color: activeTab === tab ? "var(--text-main)" : "var(--text-muted)",
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

        {activeTab === "items" && (
          <div className="stack-md">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ color: "var(--text-muted)", fontWeight: 500 }}>{tokens.length} items</div>
              {isCsharp && (
                <button className="btn btn-secondary" onClick={() => void reloadSales(collection, tokens)} style={{ padding: "0.4rem 0.8rem", fontSize: "0.85rem", borderRadius: "10px" }}>
                  <Loader2 size={14} className={loadingSales ? "animate-spin" : ""} style={{ marginRight: "0.5rem" }} />
                  Refresh Listings
                </button>
              )}
            </div>

            <NFTGrid
              tokens={tokens}
              collections={collectionsMap}
              salesByTokenId={salesByTokenId}
              listPriceByTokenId={listPriceByTokenId}
              onListPriceChange={(id, val) => setListPriceByTokenId(prev => ({ ...prev, [id]: val }))}
              onList={onListToken}
              onCancel={onCancelListing}
              onBuy={onBuyToken}
              actionTokenId={actionTokenId}
              isCsharp={isCsharp}
              walletAddress={wallet.address}
            />
          </div>
        )}

        {activeTab === "mint" && (
          <div className="panel" style={{ maxWidth: "800px", margin: "0 auto" }}>
            <div className="panel-header">
              <h3>Creator Studio</h3>
              <p className="hint">Mint new NFTs into this collection.</p>
            </div>

            <form className="form-grid" onSubmit={onMintToken}>
              <label className="full">
                Recipient Wallet Address
                <input
                  required
                  onChange={(event) => setMintForm((prev) => ({ ...prev, to: event.target.value }))}
                  value={mintForm.to}
                  placeholder="N..."
                />
              </label>

              <label className="full">
                NFT Name
                <input
                  onChange={(event) => setMintForm((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="e.g. My Awesome NFT #1"
                  value={mintForm.name}
                />
              </label>

              <label className="full">
                Description
                <textarea
                  onChange={(event) => setMintForm((prev) => ({ ...prev, description: event.target.value }))}
                  rows={4}
                  placeholder="Describe your NFT..."
                  value={mintForm.description}
                />
              </label>

              <label className="full">
                Media File
                <div className="upload-area" style={{ padding: "3rem" }}>
                   <input
                    required
                    accept="image/*,video/*"
                    onChange={(event) => setMintForm((prev) => ({ ...prev, file: event.target.files?.[0] ?? null }))}
                    type="file"
                    style={{ marginTop: 0 }}
                  />
                  <p className="hint" style={{ marginTop: "1rem" }}>PNG, JPG, GIF, MP4 (Max 20MB). Uploaded to NeoFS.</p>
                </div>
              </label>

              <div className="full form-actions" style={{ marginTop: "1rem" }}>
                <button className="btn" disabled={submittingMint || !wallet.address || !isCsharp} type="submit" style={{ width: "200px", background: "#2081E2" }}>
                  {submittingMint ? "Minting..." : "Create NFT"}
                </button>
              </div>
            </form>
          </div>
        )}

        {activeTab === "activity" && (
          <div className="panel" style={{ textAlign: "center", padding: "5rem" }}>
            <Loader2 size={48} color="var(--text-muted)" style={{ marginBottom: "1rem" }} />
            <h3>Activity tracking coming soon</h3>
            <p className="hint">We are working on integrating full on-chain activity logs.</p>
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
