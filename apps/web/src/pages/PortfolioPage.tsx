import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FolderHeart, ImageOff, ArrowUpRight, CopySlash } from "lucide-react";

import { useWallet } from "../hooks/useWallet";
import { fetchWalletTokens, getNeoFsResourceProxyUrl } from "../lib/api";
import type { TokenDto } from "../lib/types";

interface TokenGroup {
  collectionId: string;
  tokens: TokenDto[];
}

function isNeoFsUri(value: string): boolean {
  return /^neofs:(\/\/)?/i.test(value.trim());
}

export function PortfolioPage() {
  const { t } = useTranslation();
  const wallet = useWallet();
  const [tokens, setTokens] = useState<TokenDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!wallet.address) {
      setTokens([]);
      return;
    }

    let alive = true;

    (async () => {
      setLoading(true);
      setError("");
      try {
        const result = await fetchWalletTokens(wallet.address as string);
        if (alive) {
          setTokens(result);
        }
      } catch (err) {
        if (alive) {
          setTokens([]);
          setError((err as Error).message);
        }
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [wallet.address, wallet.network?.network, wallet.network?.magic]);

  const groups = useMemo<TokenGroup[]>(() => {
    const map = new Map<string, TokenDto[]>();
    tokens.forEach((token) => {
      const arr = map.get(token.collectionId) ?? [];
      arr.push(token);
      map.set(token.collectionId, arr);
    });

    return Array.from(map.entries()).map(([collectionId, groupedTokens]) => ({
      collectionId,
      tokens: groupedTokens,
    }));
  }, [tokens]);

  if (!wallet.address) {
    return <p className="hint">{t("portfolio.connect")}</p>;
  }

  return (
    <section className="stack-lg fade-in">
      <article className="panel">
        <div className="panel-header" style={{ marginBottom: '1.5rem', paddingBottom: '1rem' }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <FolderHeart size={24} /> {t("portfolio.title")}
          </h2>
          <span className="hint">{wallet.address}</span>
        </div>

        {loading ? <p className="hint">{t("portfolio.loading")}</p> : null}
        {error ? <p className="error">{error}</p> : null}
        {!loading && groups.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#9CA3AF' }}>
            <ImageOff size={48} color="#9CA3AF" style={{ margin: '0 auto 1rem', opacity: 0.5 }} />
            <p className="hint">{t("portfolio.no_nft")}</p>
          </div>
        ) : null}

        <div className="stack-md">
          {groups.map((group) => (
            <div className="portfolio-group" key={group.collectionId}>
              <div className="panel-header" style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)', paddingBottom: '0.75rem', marginBottom: '1rem' }}>
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <CopySlash size={18} /> {group.collectionId}
                </h3>
                <Link className="inline-link" to={`/collections/${group.collectionId}`} style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                  {t("portfolio.open_col")} <ArrowUpRight size={14} />
                </Link>
              </div>

              <div className="chip-row">
                {group.tokens.map((token) => (
                  <div className="chip" key={token.tokenId}>
                    <span>{token.tokenId}</span>
                    <a href={isNeoFsUri(token.uri) ? getNeoFsResourceProxyUrl(token.uri) : token.uri} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                      {t("portfolio.metadata")} <ArrowUpRight size={12} />
                    </a>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}
