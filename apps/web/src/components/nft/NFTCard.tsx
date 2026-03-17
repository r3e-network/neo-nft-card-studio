import { ShoppingCart } from "lucide-react";
import type { TokenDto } from "../../lib/types";
import { parseTokenProperties, pickTokenMediaUri, buildNftFallbackImage } from "../../lib/nft-media";
import { formatGasAmount, isValidGasAmountInput, tokenSerial, type TokenSaleState } from "../../lib/marketplace";

interface NFTCardProps {
  token: TokenDto;
  collectionName: string;
  collectionSymbol: string;
  sale: TokenSaleState;
  isOwner: boolean;
  isActing: boolean;
  isCsharp: boolean;
  walletAddress: string | null;
  listPrice: string;
  onListPriceChange: (value: string) => void;
  onList: () => void;
  onCancel: () => void;
  onBuy: () => void;
}

export function NFTCard({
  token,
  collectionName,
  collectionSymbol,
  sale,
  isOwner,
  isActing,
  isCsharp,
  walletAddress,
  listPrice,
  onListPriceChange,
  onList,
  onCancel,
  onBuy,
}: NFTCardProps) {
  const properties = parseTokenProperties(token.propertiesJson);
  const media = pickTokenMediaUri(token, properties);
  const isPendingToken = token.tokenId.startsWith("pending:");
  const displayName =
    typeof properties.name === "string" && properties.name.trim().length > 0
      ? properties.name.trim()
      : `${collectionSymbol} #${tokenSerial(token.tokenId)}`;
  const fallbackImage = buildNftFallbackImage(displayName, token.tokenId, collectionName);
  const canSubmitListing = isValidGasAmountInput(listPrice);

  return (
    <div className="panel nft-card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ height: "280px", background: "#121822", position: "relative" }}>
        <img
          alt={displayName}
          onError={(event) => {
            if (event.currentTarget.src !== fallbackImage) {
              event.currentTarget.src = fallbackImage;
            }
          }}
          src={media || fallbackImage}
          loading="lazy"
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </div>

      <div style={{ padding: "1.2rem" }}>
        <div style={{ fontWeight: 700, marginBottom: "0.25rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {displayName}
        </div>
        <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "1rem" }}>
          Token #{tokenSerial(token.tokenId)}
        </div>

        {sale.listed ? (
          <div style={{ marginBottom: "1rem" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 600 }}>Price</div>
            <div style={{ fontWeight: 700, fontSize: "1.1rem" }}>{formatGasAmount(sale.price)} GAS</div>
          </div>
        ) : isPendingToken ? (
          <div style={{ marginBottom: "1rem", height: "38px", display: "flex", alignItems: "center", color: "var(--text-muted)", fontSize: "0.9rem" }}>
            Pending indexing
          </div>
        ) : (
          <div style={{ marginBottom: "1rem", height: "38px", display: "flex", alignItems: "center", color: "var(--text-muted)", fontSize: "0.9rem" }}>
            Not listed
          </div>
        )}

        {isCsharp && !isPendingToken && (
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "1rem" }}>
            {isOwner ? (
              sale.listed ? (
                <button
                  className="btn btn-secondary"
                  disabled={isActing}
                  onClick={onCancel}
                  type="button"
                  style={{ width: "100%", borderRadius: "10px" }}
                >
                  {isActing ? "..." : "Cancel Listing"}
                </button>
              ) : (
                <div className="stack-xs">
                  <input
                    onChange={(e) => onListPriceChange(e.target.value)}
                    placeholder="Price in GAS"
                    value={listPrice}
                    style={{ height: "40px", marginBottom: "0.5rem" }}
                  />
                  <button 
                    className="btn" 
                    disabled={isActing || !canSubmitListing} 
                    onClick={onList} 
                    type="button" 
                    style={{ width: "100%", borderRadius: "10px", background: "#2081E2" }}
                  >
                    {isActing ? "..." : "List for Sale"}
                  </button>
                </div>
              )
            ) : sale.listed ? (
              <button 
                className="btn" 
                disabled={isActing || !walletAddress} 
                onClick={onBuy} 
                type="button" 
                style={{ width: "100%", borderRadius: "10px", background: "#2081E2" }}
              >
                <ShoppingCart size={16} style={{ marginRight: "0.5rem" }} /> 
                {isActing ? "..." : "Buy Now"}
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
