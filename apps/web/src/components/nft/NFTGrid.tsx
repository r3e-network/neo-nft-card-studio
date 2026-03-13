import { ImageOff } from "lucide-react";
import type { TokenDto, CollectionDto } from "../../lib/types";
import type { TokenSaleState } from "../../lib/marketplace";
import { NFTCard } from "./NFTCard";

interface NFTGridProps {
  tokens: TokenDto[];
  collections: Record<string, CollectionDto>;
  salesByTokenId: Record<string, TokenSaleState>;
  listPriceByTokenId: Record<string, string>;
  onListPriceChange: (tokenId: string, value: string) => void;
  onList: (token: TokenDto) => void;
  onCancel: (token: TokenDto) => void;
  onBuy: (token: TokenDto) => void;
  actionTokenId: string;
  isCsharp: boolean;
  walletAddress: string | null;
}

export function NFTGrid({
  tokens,
  collections,
  salesByTokenId,
  listPriceByTokenId,
  onListPriceChange,
  onList,
  onCancel,
  onBuy,
  actionTokenId,
  isCsharp,
  walletAddress,
}: NFTGridProps) {
  if (tokens.length === 0) {
    return (
      <div className="panel" style={{ textAlign: "center", padding: "4rem" }}>
        <ImageOff size={48} color="var(--text-muted)" style={{ marginBottom: "1rem" }} />
        <h3>No items yet</h3>
        <p className="hint">Items will appear here once they are minted.</p>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: "1.5rem", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
      {tokens.map((token) => {
        const collection = collections[token.collectionId] ?? { name: "Unknown", symbol: "NFT" };
        const sale = salesByTokenId[token.tokenId] ?? { listed: false, seller: "", price: "0", listedAt: "" };
        const isOwner = !!walletAddress && walletAddress === token.owner;
        
        return (
          <NFTCard
            key={token.tokenId}
            token={token}
            collectionName={collection.name}
            collectionSymbol={collection.symbol}
            sale={sale}
            isOwner={isOwner}
            isActing={actionTokenId === token.tokenId}
            isCsharp={isCsharp}
            walletAddress={walletAddress}
            listPrice={listPriceByTokenId[token.tokenId] ?? ""}
            onListPriceChange={(value) => onListPriceChange(token.tokenId, value)}
            onList={() => onList(token)}
            onCancel={() => onCancel(token)}
            onBuy={() => onBuy(token)}
          />
        );
      })}
    </div>
  );
}
