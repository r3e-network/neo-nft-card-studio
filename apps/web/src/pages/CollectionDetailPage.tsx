import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowUpRight, ImageOff, Loader2, ShoppingCart, Tag } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useWallet } from "../hooks/useWallet";
import { fetchCollection, fetchCollectionTokens, fetchGhostMarketMeta, getNeoFsResourceProxyUrl, uploadToNeoFs } from "../lib/api";
import { toUserErrorMessage } from "../lib/errors";
import {
  formatGasAmount,
  isZeroUInt160Hash,
  parseGasAmountToInteger,
  parseTokenSale,
  shortHash,
  tokenSerial,
  toIsoTime,
  type TokenSaleState,
} from "../lib/marketplace";
import { getNftClientForHash, getPlatformClient } from "../lib/platformClient";
import { useRuntimeContractDialect } from "../lib/runtime-dialect";
import type { CollectionDto, GhostMarketMetaDto, TokenDto } from "../lib/types";

interface MintFormState {
  to: string;
  name: string;
  description: string;
  file: File | null;
}

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
      const client = getCollectionClient(nextCollection);
      const entries = await Promise.all(
        nextTokens.map(async (token) => {
          const raw = await client.getTokenSale(token.tokenId);
          return [token.tokenId, parseTokenSale(raw)] as const;
        }),
      );

      setSalesByTokenId(Object.fromEntries(entries));
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
      <section className="panel">
        <p className="hint">Loading collection...</p>
      </section>
    );
  }

  if (!collection) {
    return (
      <section className="panel">
        <h2>Collection not found</h2>
        <p className="hint">{error || "The collection does not exist on current network."}</p>
        <Link className="btn btn-secondary" to="/explore">
          Back to Explore
        </Link>
      </section>
    );
  }

  return (
    <div className="stack-lg fade-in">
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>{collection.name}</h2>
            <p className="hint" style={{ marginTop: "0.5rem" }}>
              {collection.symbol} · Owner {shortHash(collection.owner)}
            </p>
          </div>
          <div className="chip-row">
            <span className="chip">{isDedicatedCollection ? "Dedicated Contract" : "Shared Factory"}</span>
            <span className="chip">Minted {collection.minted}</span>
            <span className="chip">Max {collection.maxSupply === "0" ? "Unlimited" : collection.maxSupply}</span>
            <span className="chip">Royalty {(collection.royaltyBps / 100).toFixed(2)}%</span>
            {isCsharp ? <span className="chip">Listed {listedCount}</span> : null}
          </div>
        </div>

        <p style={{ marginBottom: "1rem", color: "var(--text-muted)" }}>{collection.description || "No description"}</p>

        <div className="chip-row">
          <Link className="btn btn-secondary" to="/mint">
            Mint Via Studio
          </Link>
          <Link className="btn btn-secondary" to="/explore">
            Explore Marketplace
          </Link>
          {ghostMarket?.enabled ? (
            <a className="btn btn-secondary" href={ghostMarket.contractSearchUrl} rel="noreferrer" target="_blank">
              View on GhostMarket
              <ArrowUpRight size={16} />
            </a>
          ) : null}
        </div>

        {ghostMarket?.compatibility ? (
          <p className="hint" style={{ marginTop: "1rem" }}>
            GhostMarket: {ghostMarket.compatibility.compatible ? "compatible" : "partially compatible"}
          </p>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Quick Mint</h3>
          <p className="hint">Mint directly into this collection.</p>
        </div>

        <form className="form-grid" onSubmit={onMintToken}>
          <label>
            Recipient
            <input
              required
              onChange={(event) => setMintForm((prev) => ({ ...prev, to: event.target.value }))}
              value={mintForm.to}
            />
          </label>

          <label>
            NFT Name
            <input
              onChange={(event) => setMintForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Genesis #1"
              value={mintForm.name}
            />
          </label>

          <label className="full">
            Description
            <textarea
              onChange={(event) => setMintForm((prev) => ({ ...prev, description: event.target.value }))}
              rows={3}
              value={mintForm.description}
            />
          </label>

          <label className="full">
            Media File
            <input
              accept="image/*,video/*"
              onChange={(event) => setMintForm((prev) => ({ ...prev, file: event.target.files?.[0] ?? null }))}
              type="file"
            />
            <p className="hint">File will be uploaded to NeoFS as token URI and metadata image source.</p>
          </label>

          <div className="full form-actions">
            <button className="btn" disabled={submittingMint || !wallet.address || !isCsharp} type="submit">
              {submittingMint ? "Submitting..." : "Mint NFT"}
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>NFTs</h3>
          <div className="chip-row">
            {loadingSales ? (
              <span className="chip">
                <Loader2 size={12} />
                Refreshing listings
              </span>
            ) : null}
            {isCsharp ? (
              <button className="btn btn-secondary" onClick={() => void reloadSales(collection, tokens)} type="button">
                Refresh Listing State
              </button>
            ) : null}
          </div>
        </div>

        {tokens.length === 0 ? (
          <p className="hint">No NFTs minted yet.</p>
        ) : (
          <div style={{ display: "grid", gap: "1.25rem", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
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

              return (
                <article className="token-card" key={token.tokenId}>
                  {media ? (
                    <img alt={displayName} className="metadata-media" src={media} />
                  ) : (
                    <div className="metadata-media flex-center">
                      <ImageOff color="#8aa0bf" size={26} />
                    </div>
                  )}

                  <div className="stack-sm">
                    <strong>{displayName}</strong>
                    <span className="hint">Token #{tokenSerial(token.tokenId)}</span>
                    <span className="hint">Owner {shortHash(token.owner)}</span>
                  </div>

                  {sale.listed ? (
                    <div className="chip-row">
                      <span className="chip">
                        <Tag size={12} /> {formatGasAmount(sale.price)} GAS
                      </span>
                      <span className="chip">Listed {toIsoTime(sale.listedAt) || "now"}</span>
                    </div>
                  ) : (
                    <span className="hint">Not listed</span>
                  )}

                  {isCsharp ? (
                    <div className="token-actions">
                      {isOwner ? (
                        sale.listed ? (
                          <button
                            className="btn btn-secondary"
                            disabled={isActing}
                            onClick={() => void onCancelListing(token)}
                            type="button"
                          >
                            {isActing ? "Submitting..." : "Cancel Listing"}
                          </button>
                        ) : (
                          <>
                            <input
                              onChange={(event) =>
                                setListPriceByTokenId((prev) => ({ ...prev, [token.tokenId]: event.target.value }))
                              }
                              placeholder="Price in GAS (e.g. 1.25)"
                              value={listPriceByTokenId[token.tokenId] ?? ""}
                            />
                            <button className="btn" disabled={isActing} onClick={() => void onListToken(token)} type="button">
                              {isActing ? "Submitting..." : "List for Sale"}
                            </button>
                          </>
                        )
                      ) : sale.listed ? (
                        <button className="btn" disabled={isActing || !wallet.address} onClick={() => void onBuyToken(token)} type="button">
                          <ShoppingCart size={16} /> {isActing ? "Submitting..." : `Buy ${formatGasAmount(sale.price)} GAS`}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {message ? <p className="success">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
