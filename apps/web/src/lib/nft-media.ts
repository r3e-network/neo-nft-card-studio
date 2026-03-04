import { getNeoFsResourceProxyUrl } from "./api";
import type { TokenDto } from "./types";

const IMAGE_URI_REGEX = /\.(?:apng|avif|bmp|gif|ico|jpe?g|jfif|pjpeg|pjp|png|svg|webp)(?:[?#].*)?$/i;
const METADATA_URI_REGEX = /\.(?:json|xml|txt)(?:[?#].*)?$/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function isNeoFsUri(value: string): boolean {
  return /^neofs:(\/\/)?/i.test(value.trim());
}

function normalizeMediaUri(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }

  if (isNeoFsUri(trimmed)) {
    return getNeoFsResourceProxyUrl(trimmed);
  }

  if (/^https?:\/\//i.test(trimmed) || /^data:/i.test(trimmed)) {
    return trimmed;
  }

  return "";
}

function isLikelyImageUri(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) {
    return false;
  }

  if (/^data:image\//i.test(trimmed)) {
    return true;
  }

  if (isNeoFsUri(trimmed)) {
    return true;
  }

  return IMAGE_URI_REGEX.test(trimmed);
}

function isLikelyMetadataUri(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) {
    return false;
  }

  if (/^data:application\/json/i.test(trimmed)) {
    return true;
  }

  return METADATA_URI_REGEX.test(trimmed);
}

function collectPropertyMediaCandidates(properties: Record<string, unknown>): string[] {
  const candidates: string[] = [];
  const keys = [
    "image",
    "image_url",
    "imageUrl",
    "thumbnail",
    "thumbnail_url",
    "thumbnailUrl",
    "cover",
    "coverImage",
    "cover_image",
    "animation_url",
    "animationUrl",
    "media",
  ];

  for (const key of keys) {
    const value = properties[key];
    if (typeof value === "string") {
      candidates.push(value);
    }
  }

  const nestedObjects = [
    asRecord(properties.metadata),
    asRecord(properties.properties),
    asRecord(properties.asset),
  ];
  for (const nested of nestedObjects) {
    if (!nested) {
      continue;
    }

    for (const key of keys) {
      const value = nested[key];
      if (typeof value === "string") {
        candidates.push(value);
      }
    }
  }

  return candidates;
}

export function parseTokenProperties(raw: string): Record<string, unknown> {
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

export function pickTokenMediaUri(token: TokenDto, properties: Record<string, unknown>): string {
  for (const candidate of collectPropertyMediaCandidates(properties)) {
    const normalized = normalizeMediaUri(candidate);
    if (normalized) {
      return normalized;
    }
  }

  const tokenUri = token.uri?.trim() ?? "";
  if (!tokenUri) {
    return "";
  }

  const normalizedTokenUri = normalizeMediaUri(tokenUri);
  if (!normalizedTokenUri) {
    return "";
  }

  if (isLikelyMetadataUri(tokenUri) && !isLikelyImageUri(tokenUri)) {
    return "";
  }

  return normalizedTokenUri;
}

function escapeXml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function hashText(input: string): number {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) - hash + input.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function truncate(input: string, maxLength: number): string {
  if (input.length <= maxLength) {
    return input;
  }
  return `${input.slice(0, Math.max(0, maxLength - 1))}…`;
}

const FALLBACK_PALETTES: Array<[string, string]> = [
  ["#0E7490", "#2563EB"],
  ["#1D4ED8", "#4338CA"],
  ["#0F766E", "#0369A1"],
  ["#0F766E", "#15803D"],
  ["#7C2D12", "#B91C1C"],
  ["#334155", "#0284C7"],
  ["#0F172A", "#1E40AF"],
];

export function buildNftFallbackImage(name: string, tokenId: string, collectionName?: string): string {
  const safeName = truncate((name || "NFT").trim() || "NFT", 28);
  const safeCollection = truncate((collectionName || "OpenNFT").trim() || "OpenNFT", 24);
  const safeTokenId = truncate((tokenId || "0").trim() || "0", 28);
  const paletteIndex = hashText(`${safeCollection}:${safeTokenId}`) % FALLBACK_PALETTES.length;
  const [colorA, colorB] = FALLBACK_PALETTES[paletteIndex];

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200" role="img" aria-label="${escapeXml(safeName)}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${colorA}"/><stop offset="100%" stop-color="${colorB}"/></linearGradient></defs><rect width="1200" height="1200" fill="url(#g)"/><circle cx="960" cy="220" r="240" fill="rgba(255,255,255,0.12)"/><circle cx="140" cy="980" r="260" fill="rgba(255,255,255,0.08)"/><rect x="84" y="84" width="1032" height="1032" rx="40" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="6"/><text x="110" y="820" font-family="ui-sans-serif, -apple-system, Segoe UI, Roboto, Helvetica, Arial" font-size="42" fill="rgba(255,255,255,0.84)">${escapeXml(safeCollection)}</text><text x="110" y="900" font-family="ui-sans-serif, -apple-system, Segoe UI, Roboto, Helvetica, Arial" font-size="72" font-weight="700" fill="#ffffff">${escapeXml(safeName)}</text><text x="110" y="980" font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas" font-size="36" fill="rgba(255,255,255,0.78)">#${escapeXml(safeTokenId)}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
