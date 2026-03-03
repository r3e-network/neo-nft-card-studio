import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ImageOff, Loader2, Search, ShoppingCart, Tag } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useWallet } from "../hooks/useWallet";
import { fetchMarketListings, getNeoFsResourceProxyUrl } from "../lib/api";
import { toUserErrorMessage } from "../lib/errors";
import { formatGasAmount, isZeroUInt160Hash, shortHash, tokenSerial } from "../lib/marketplace";
import { getNftClientForHash, getPlatformClient } from "../lib/platformClient";
import { useRuntimeContractDialect } from "../lib/runtime-dialect";
import type { CollectionDto, MarketListingDto, TokenDto } from "../lib/types";

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
  const candidates = [
    properties.image,
    properties.image_url,
    properties.imageUrl,
    properties.animation_url,
    properties.animationUrl,
    token.uri,
  ];

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

export function ExplorePage() {
  const wallet = useWallet();
  const { t } = useTranslation();
  const contractDialect = useRuntimeContractDialect();

  const [cards, setCards] = useState<MarketListingDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [actionTokenId, setActionTokenId] = useState("");

  const isCsharp = contractDialect === "csharp";

  const reloadMarket = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const listings = await fetchMarketListings({ limit: 500 });
      setCards(listings.filter((entry) => entry.token.burned !== 1));
    } catch (err) {
      setCards([]);
      setError(toUserErrorMessage(t, err));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void reloadMarket();
  }, [reloadMarket, wallet.network?.network, wallet.network?.magic]);

  const visibleCards = useMemo(() => {
    const q = query.trim().toLowerCase();

    const filtered = cards.filter((card) => {
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
  }, [cards, query]);

  const listedCount = useMemo(() => visibleCards.filter((card) => card.sale.listed).length, [visibleCards]);

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
      await reloadMarket();
    } catch (err) {
      setError(toUserErrorMessage(t, err));
    } finally {
      setActionTokenId("");
    }
  };

  return (
    <div className="stack-lg fade-in">
      <section className="panel">
        <div className="panel-header" style={{ alignItems: "flex-end" }}>
          <div>
            <h2>Explore Marketplace</h2>
            <p className="hint" style={{ marginTop: "0.5rem" }}>
              Browse all minted NFTs. Listed assets are shown first.
            </p>
          </div>
          <div className="chip-row">
            <span className="chip">NFTs {visibleCards.length}</span>
            {isCsharp ? <span className="chip">Listed {listedCount}</span> : null}
          </div>
        </div>

        <label style={{ display: "block" }}>
          <span className="hint">Search by token, owner, collection</span>
          <div style={{ position: "relative", marginTop: "0.6rem" }}>
            <Search size={16} style={{ left: "0.9rem", opacity: 0.7, position: "absolute", top: "0.95rem" }} />
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="collection name / token id / owner"
              style={{ paddingLeft: "2.6rem" }}
              value={query}
            />
          </div>
        </label>
      </section>

      {loading ? (
        <section className="panel">
          <p className="hint">Loading marketplace...</p>
        </section>
      ) : visibleCards.length === 0 ? (
        <section className="panel">
          <p className="hint">No NFTs found for current filters.</p>
          <Link className="btn btn-secondary" to="/collections/new">
            Create Collection
          </Link>
        </section>
      ) : (
        <section>
          <div style={{ display: "grid", gap: "1.25rem", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
            {visibleCards.map((card) => {
              const properties = parseTokenProperties(card.token.propertiesJson);
              const media = pickTokenMediaUri(card.token, properties);
              const tokenName =
                typeof properties.name === "string" && properties.name.trim().length > 0
                  ? properties.name.trim()
                  : `${card.collection.symbol} #${tokenSerial(card.token.tokenId)}`;
              const isOwner = wallet.address === card.token.owner;
              const isBuying = actionTokenId === card.token.tokenId;

              return (
                <article className="token-card" key={card.token.tokenId}>
                  <Link style={{ color: "inherit", textDecoration: "none" }} to={`/collections/${card.collection.collectionId}`}>
                    {media ? (
                      <img alt={tokenName} className="metadata-media" src={media} />
                    ) : (
                      <div className="metadata-media flex-center">
                        <ImageOff color="#8aa0bf" size={26} />
                      </div>
                    )}
                  </Link>

                  <div className="stack-sm">
                    <strong>{tokenName}</strong>
                    <span className="hint">{card.collection.name}</span>
                    <span className="hint">Owner {shortHash(card.token.owner)}</span>
                    <span className="hint">Token #{tokenSerial(card.token.tokenId)}</span>
                  </div>

                  {card.sale.listed ? (
                    <div className="chip-row">
                      <span className="chip">
                        <Tag size={12} /> {formatGasAmount(card.sale.price)} GAS
                      </span>
                    </div>
                  ) : (
                    <span className="hint">Not listed</span>
                  )}

                  {isCsharp && card.sale.listed && !isOwner ? (
                    <button
                      className="btn"
                      disabled={isBuying || !wallet.address}
                      onClick={() => void onBuyToken(card)}
                      type="button"
                    >
                      <ShoppingCart size={15} /> {isBuying ? "Submitting..." : `Buy ${formatGasAmount(card.sale.price)} GAS`}
                    </button>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      )}

      {loading ? null : (
        <section className="panel" style={{ padding: "1rem 1.2rem" }}>
          <p className="hint" style={{ alignItems: "center", display: "flex", gap: "0.5rem", margin: 0 }}>
            <Loader2 size={14} /> Listing states are loaded from API aggregation endpoint `/market/listings`.
          </p>
        </section>
      )}

      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
