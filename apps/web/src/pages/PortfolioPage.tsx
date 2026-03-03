import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FolderOpen, ImageOff, Loader2, Settings, Tag, Wallet } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useWallet } from "../hooks/useWallet";
import { fetchCollections, fetchMarketListings, getNeoFsResourceProxyUrl } from "../lib/api";
import { toUserErrorMessage } from "../lib/errors";
import { formatGasAmount, isZeroUInt160Hash, parseGasAmountToInteger, shortHash, tokenSerial } from "../lib/marketplace";
import { getNftClientForHash, getPlatformClient } from "../lib/platformClient";
import { useRuntimeContractDialect } from "../lib/runtime-dialect";
import type { CollectionDto, MarketListingDto, TokenDto } from "../lib/types";

type Tab = "collected" | "created";

function isNeoFsUri(value: string): boolean {
  return /^neofs:(\/\/)?/i.test(value.trim());
}

function parseTokenProperties(raw: string): Record<string, unknown> {
  if (!raw || raw.trim().length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function pickTokenMediaUri(token: TokenDto, properties: Record<string, unknown>): string {
  const candidates = [properties.image, properties.image_url, properties.imageUrl, token.uri];

  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }

    const trimmed = candidate.trim();
    if (!trimmed) {
      continue;
    }

    if (isNeoFsUri(trimmed)) {
      return getNeoFsResourceProxyUrl(trimmed);
    }

    if (/^https?:\/\//i.test(trimmed) || /^data:/i.test(trimmed)) {
      return trimmed;
    }
  }

  return "";
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

  const listedCount = useMemo(
    () => collectedListings.filter((entry) => entry.sale.listed).length,
    [collectedListings],
  );

  if (!wallet.address) {
    return (
      <section className="panel">
        <div className="flex-center" style={{ flexDirection: "column", gap: "1rem", minHeight: "50vh" }}>
          <Wallet color="#8aa0bf" size={42} />
          <h2>Connect Wallet</h2>
          <p className="hint">Connect your wallet to view collected NFTs and created collections.</p>
          <button className="btn" onClick={() => void wallet.connect()} type="button">
            Connect Wallet
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="stack-lg fade-in">
      <section className="panel">
        <div className="panel-header" style={{ alignItems: "flex-end" }}>
          <div>
            <h2>Portfolio</h2>
            <p className="hint" style={{ marginTop: "0.5rem" }}>
              {shortHash(wallet.address)}
            </p>
          </div>

          <div className="chip-row">
            <span className="chip">Collected {collectedListings.length}</span>
            <span className="chip">Created {createdCollections.length}</span>
            {isCsharp ? <span className="chip">Listed {listedCount}</span> : null}
          </div>
        </div>

        <div style={{ borderBottom: "1px solid var(--glass-border)", display: "flex", gap: "1rem", paddingBottom: "0.6rem" }}>
          <button className={`btn btn-secondary ${tab === "collected" ? "active" : ""}`} onClick={() => setTab("collected")} type="button">
            Collected
          </button>
          <button className={`btn btn-secondary ${tab === "created" ? "active" : ""}`} onClick={() => setTab("created")} type="button">
            Created
          </button>
          <button className="btn btn-secondary" onClick={() => void reloadPortfolio()} type="button">
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </section>

      {tab === "collected" ? (
        <section>
          {loading ? (
            <div className="panel">
              <p className="hint">Loading collected NFTs...</p>
            </div>
          ) : collectedListings.length === 0 ? (
            <div className="panel">
              <p className="hint">No NFTs collected yet.</p>
              <Link className="btn btn-secondary" to="/explore">
                Explore Marketplace
              </Link>
            </div>
          ) : (
            <div style={{ display: "grid", gap: "1.25rem", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))" }}>
              {collectedListings.map((entry) => {
                const properties = parseTokenProperties(entry.token.propertiesJson);
                const media = pickTokenMediaUri(entry.token, properties);
                const tokenName =
                  typeof properties.name === "string" && properties.name.trim().length > 0
                    ? properties.name.trim()
                    : `${entry.collection.symbol} #${tokenSerial(entry.token.tokenId)}`;
                const isActing = actionTokenId === entry.token.tokenId;

                return (
                  <article className="token-card" key={entry.token.tokenId}>
                    {media ? (
                      <img alt={tokenName} className="metadata-media" src={media} />
                    ) : (
                      <div className="metadata-media flex-center">
                        <ImageOff color="#8aa0bf" size={24} />
                      </div>
                    )}

                    <div className="stack-sm">
                      <strong>{tokenName}</strong>
                      <span className="hint">{entry.collection.name}</span>
                      <span className="hint">Token #{tokenSerial(entry.token.tokenId)}</span>
                    </div>

                    {entry.sale.listed ? (
                      <span className="chip">
                        <Tag size={12} /> {formatGasAmount(entry.sale.price)} GAS
                      </span>
                    ) : (
                      <span className="hint">Not listed</span>
                    )}

                    {isCsharp ? (
                      <div className="token-actions">
                        {entry.sale.listed ? (
                          <button
                            className="btn btn-secondary"
                            disabled={isActing}
                            onClick={() => void onCancelListing(entry)}
                            type="button"
                          >
                            {isActing ? "Submitting..." : "Cancel Listing"}
                          </button>
                        ) : (
                          <>
                            <input
                              onChange={(event) =>
                                setListPriceByTokenId((prev) => ({ ...prev, [entry.token.tokenId]: event.target.value }))
                              }
                              placeholder="Price in GAS"
                              value={listPriceByTokenId[entry.token.tokenId] ?? ""}
                            />
                            <button className="btn" disabled={isActing} onClick={() => void onListToken(entry)} type="button">
                              {isActing ? "Submitting..." : "List for Sale"}
                            </button>
                          </>
                        )}
                      </div>
                    ) : null}

                    <Link className="btn btn-secondary" to={`/collections/${entry.collection.collectionId}`}>
                      Open Collection
                    </Link>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ) : (
        <section>
          {loading ? (
            <div className="panel">
              <p className="hint">Loading created collections...</p>
            </div>
          ) : createdCollections.length === 0 ? (
            <div className="panel">
              <p className="hint">No collections created yet.</p>
              <Link className="btn" to="/collections/new">
                Create Collection
              </Link>
            </div>
          ) : (
            <div style={{ display: "grid", gap: "1.25rem", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
              {createdCollections.map((collection) => {
                const dedicatedHash = resolveCollectionContractHash(collection);

                return (
                  <article className="token-card" key={collection.collectionId}>
                    <div className="stack-sm">
                      <strong>{collection.name}</strong>
                      <span className="hint">{collection.symbol}</span>
                      <span className="hint">Minted {collection.minted}</span>
                      <span className="hint">Royalty {(collection.royaltyBps / 100).toFixed(2)}%</span>
                    </div>

                    <div className="chip-row">
                      <span className="chip">{dedicatedHash ? "Dedicated" : "Shared"}</span>
                      {dedicatedHash ? <span className="chip">{shortHash(dedicatedHash)}</span> : null}
                    </div>

                    <div className="token-actions" style={{ borderTop: "none", marginTop: 0, paddingTop: 0 }}>
                      <Link className="btn" to={`/collections/${collection.collectionId}`}>
                        <FolderOpen size={14} /> Manage
                      </Link>
                      <Link className="btn btn-secondary" to="/mint">
                        <Settings size={14} /> Mint
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {loading ? (
        <p className="hint" style={{ alignItems: "center", display: "flex", gap: "0.4rem" }}>
          <Loader2 size={14} /> Syncing portfolio...
        </p>
      ) : null}

      {message ? <p className="success">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
