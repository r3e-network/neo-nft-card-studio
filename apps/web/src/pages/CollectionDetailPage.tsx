import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowUpRight, ImageOff, Loader2, ShoppingCart, Tag, ExternalLink, Globe, Twitter, Share2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useWallet } from "../hooks/useWallet";
import { fetchCollection, fetchCollectionTokens, fetchGhostMarketMeta, fetchMarketListings, getNeoFsResourceProxyUrl, uploadToNeoFs } from "../lib/api";
import { toUserErrorMessage } from "../lib/errors";
import {
  formatGasAmount,
  isZeroUInt160Hash,
  parseGasAmountToInteger,
  shortHash,
  tokenSerial,
  toIsoTime,
  type TokenSaleState,
} from "../lib/marketplace";
import { buildNftFallbackImage, parseTokenProperties, pickTokenMediaUri } from "../lib/nft-media";
import { getNftClientForHash, getPlatformClient } from "../lib/platformClient";
import { useRuntimeContractDialect } from "../lib/runtime-dialect";
import type { CollectionDto, GhostMarketMetaDto, TokenDto } from "../lib/types";

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

  const isCsharp = contractDialect === "csharp";
  const isDedicatedCollection = collection ? resolveCollectionContractHash(collection) !== null : false;

  useEffect(() => {
    setMintForm((prev) => ({ ...prev, to: wallet.address ?? "" }));
  }, [wallet.address]);

  const reloadCollection = async () => {
    if (!collectionId) {
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

      setCollection(fetchedCollection);
      setTokens(fetchedTokens);
      setGhostMarket(fetchedGhostMeta);

      if (isCsharp) {
        await reloadSales(fetchedCollection, fetchedTokens);
      } else {
        setSalesByTokenId({});
      }
    } catch (err) {
      setError(toUserErrorMessage(t, err));
      setCollection(null);
      setTokens([]);
      setGhostMarket(null);
      setSalesByTokenId({});
    } finally {
      setLoading(false);
    }
  };

  const reloadSales = async (nextCollection: CollectionDto | null, nextTokens: TokenDto[]) => {
    if (!isCsharp || !nextCollection || nextTokens.length === 0) {
      setSalesByTokenId({});
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

      setSalesByTokenId(byTokenId);
    } catch {
      setSalesByTokenId({});
    } finally {
      setLoadingSales(false);
    }
  };

  useEffect(() => {
    let alive = true;

    (async () => {
      if (!collectionId) {
        setLoading(false);
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

        if (!alive) {
          return;
        }

        setCollection(fetchedCollection);
        setTokens(fetchedTokens);
        setGhostMarket(fetchedGhostMeta);

        if (isCsharp) {
          await reloadSales(fetchedCollection, fetchedTokens);
        }
      } catch (err) {
        if (!alive) {
          return;
        }

        setError(toUserErrorMessage(t, err));
        setCollection(null);
        setTokens([]);
        setGhostMarket(null);
        setSalesByTokenId({});
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [collectionId, isCsharp, wallet.network?.network, wallet.network?.magic]);

  const listedCount = useMemo(
    () => Object.values(salesByTokenId).filter((sale) => sale.listed).length,
    [salesByTokenId],
  );

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

      await reloadCollection();
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
      await reloadSales(collection, tokens);
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
      await reloadSales(collection, tokens);
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
      await reloadCollection();
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

  return (
    <div className="fade-in" style={{ margin: "-1.4rem -1.2rem 0" }}>
      {/* Banner Section */}
      <div style={{ height: "300px", background: "linear-gradient(45deg, #121822, #1c2638)", position: "relative" }}>
        {/* Collection Logo */}
        <div style={{ 
          position: "absolute", 
          bottom: "-80px", 
          left: "40px", 
          width: "160px", 
          height: "160px", 
          borderRadius: "16px", 
          border: "6px solid #04060A", 
          background: "linear-gradient(135deg, #2081E2, #00E599)",
          boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
          zIndex: 10
        }}></div>
      </div>

      <div style={{ padding: "100px 40px 40px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div className="stack-sm">
            <h1 style={{ fontSize: "2.5rem", fontWeight: 700, margin: 0 }}>{collection.name}</h1>
            <div style={{ display: "flex", alignItems: "center", gap: "1rem", color: "#8A939B", fontWeight: 500 }}>
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
            <div style={{ fontSize: "0.85rem", color: "#8A939B" }}>Items</div>
          </div>
          <div>
            <div style={{ fontSize: "1.2rem", fontWeight: 700 }}>{collection.owner === wallet.address ? "1" : "0"}</div>
            <div style={{ fontSize: "0.85rem", color: "#8A939B" }}>Owners</div>
          </div>
          <div>
            <div style={{ fontSize: "1.2rem", fontWeight: 700 }}>{(collection.royaltyBps / 100).toFixed(1)}%</div>
            <div style={{ fontSize: "0.85rem", color: "#8A939B" }}>Creator Fee</div>
          </div>
          <div>
            <div style={{ fontSize: "1.2rem", fontWeight: 700 }}>{isDedicatedCollection ? "Isolated" : "Shared"}</div>
            <div style={{ fontSize: "0.85rem", color: "#8A939B" }}>Deployment</div>
          </div>
        </div>

        <p style={{ maxWidth: "800px", lineHeight: 1.6, color: "#8A939B", fontSize: "1.1rem" }}>
          {collection.description || "No description provided for this collection."}
        </p>

        {/* Tabs */}
        <div style={{ display: "flex", gap: "2rem", borderBottom: "1px solid rgba(255, 255, 255, 0.1)", margin: "2rem 0" }}>
          {["items", "mint", "activity"].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                background: "none",
                border: "none",
                padding: "1rem 0",
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

        {activeTab === "items" && (
          <div className="stack-md">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ color: "#8A939B", fontWeight: 500 }}>{tokens.length} items</div>
              {isCsharp && (
                <button className="btn btn-secondary" onClick={() => void reloadSales(collection, tokens)} style={{ padding: "0.4rem 0.8rem", fontSize: "0.85rem", borderRadius: "10px" }}>
                  <Loader2 size={14} className={loadingSales ? "animate-spin" : ""} style={{ marginRight: "0.5rem" }} />
                  Refresh Listings
                </button>
              )}
            </div>

            {tokens.length === 0 ? (
              <div className="panel" style={{ textAlign: "center", padding: "4rem" }}>
                <ImageOff size={48} color="#8A939B" style={{ marginBottom: "1rem" }} />
                <h3>No items yet</h3>
                <p className="hint">Items will appear here once they are minted.</p>
              </div>
            ) : (
              <div style={{ display: "grid", gap: "1.5rem", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
                {tokens.map((token) => {
                  const properties = parseTokenProperties(token.propertiesJson);
                  const media = pickTokenMediaUri(token, properties);
                  const sale = salesByTokenId[token.tokenId] ?? { listed: false, seller: "", price: "0", listedAt: "" };
                  const isOwner = !!wallet.address && wallet.address === token.owner;
                  const isActing = actionTokenId === token.tokenId;
                  const displayName =
                    typeof properties.name === "string" && properties.name.trim().length > 0
                      ? properties.name.trim()
                      : `${collection.symbol} #${tokenSerial(token.tokenId)}`;
                  const fallbackImage = buildNftFallbackImage(displayName, token.tokenId, collection.name);

                  return (
                    <div className="panel" key={token.tokenId} style={{ padding: 0, overflow: "hidden" }}>
                      <img
                        alt={displayName}
                        onError={(event) => {
                          if (event.currentTarget.src !== fallbackImage) {
                            event.currentTarget.src = fallbackImage;
                          }
                        }}
                        src={media || fallbackImage}
                        style={{ width: "100%", height: "280px", objectFit: "cover" }}
                      />

                      <div style={{ padding: "1.2rem" }}>
                        <div style={{ fontWeight: 700, marginBottom: "0.25rem" }}>{displayName}</div>
                        <div style={{ fontSize: "0.85rem", color: "#8A939B", marginBottom: "1rem" }}>Token #{tokenSerial(token.tokenId)}</div>

                        {sale.listed ? (
                          <div style={{ marginBottom: "1rem" }}>
                            <div style={{ fontSize: "0.75rem", color: "#8A939B", fontWeight: 600 }}>Price</div>
                            <div style={{ fontWeight: 700, fontSize: "1.1rem" }}>{formatGasAmount(sale.price)} GAS</div>
                          </div>
                        ) : (
                          <div style={{ marginBottom: "1rem", height: "38px", display: "flex", alignItems: "center", color: "#8A939B", fontSize: "0.9rem" }}>Not listed</div>
                        )}

                        {isCsharp && (
                          <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "1rem" }}>
                            {isOwner ? (
                              sale.listed ? (
                                <button
                                  className="btn btn-secondary"
                                  disabled={isActing}
                                  onClick={() => void onCancelListing(token)}
                                  type="button"
                                  style={{ width: "100%", borderRadius: "10px" }}
                                >
                                  {isActing ? "..." : "Cancel Listing"}
                                </button>
                              ) : (
                                <div className="stack-xs">
                                  <input
                                    onChange={(event) =>
                                      setListPriceByTokenId((prev) => ({ ...prev, [token.tokenId]: event.target.value }))
                                    }
                                    placeholder="Price in GAS"
                                    value={listPriceByTokenId[token.tokenId] ?? ""}
                                    style={{ height: "40px", marginBottom: "0.5rem" }}
                                  />
                                  <button className="btn" disabled={isActing} onClick={() => void onListToken(token)} type="button" style={{ width: "100%", borderRadius: "10px", background: "#2081E2" }}>
                                    {isActing ? "..." : "List for Sale"}
                                  </button>
                                </div>
                              )
                            ) : sale.listed ? (
                              <button className="btn" disabled={isActing || !wallet.address} onClick={() => void onBuyToken(token)} type="button" style={{ width: "100%", borderRadius: "10px", background: "#2081E2" }}>
                                <ShoppingCart size={16} style={{ marginRight: "0.5rem" }} /> {isActing ? "..." : "Buy Now"}
                              </button>
                            ) : null}
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
            <Loader2 size={48} color="#8A939B" style={{ marginBottom: "1rem" }} />
            <h3>Activity tracking coming soon</h3>
            <p className="hint">We are working on integrating full on-chain activity logs.</p>
          </div>
        )}
      </div>

      {message ? <p className="success" style={{ position: "fixed", bottom: "2rem", right: "2rem", maxWidth: "400px", zIndex: 100 }}>{message}</p> : null}
      {error ? <p className="error" style={{ position: "fixed", bottom: "2rem", right: "2rem", maxWidth: "400px", zIndex: 100 }}>{error}</p> : null}
    </div>
  );
}
