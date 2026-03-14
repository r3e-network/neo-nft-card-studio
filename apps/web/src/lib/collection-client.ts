import { isZeroUInt160Hash } from "./marketplace";
import { getNftClientForHash, getPlatformClient } from "./platformClient";
import type { CollectionDto } from "./types";

export function resolveCollectionContractHash(
  collection: Pick<CollectionDto, "contractHash">,
): string | null {
  if (!collection.contractHash) {
    return null;
  }

  const trimmed = collection.contractHash.trim();
  if (!trimmed || isZeroUInt160Hash(trimmed)) {
    return null;
  }

  return trimmed;
}

export function getCollectionClient(collection: Pick<CollectionDto, "contractHash">) {
  const dedicatedHash = resolveCollectionContractHash(collection);
  return dedicatedHash ? getNftClientForHash(dedicatedHash) : getPlatformClient();
}
