import type { CollectionDto, TokenDto } from "./types";

export interface TokenSaleState {
  listed: boolean;
  seller: string;
  price: string;
  listedAt: string;
}

export interface TokenCardItem {
  token: TokenDto;
  collection: CollectionDto;
  sale: TokenSaleState;
}

const ZERO_UINT160 = "0x0000000000000000000000000000000000000000";

export function shortHash(value: string): string {
  if (!value || value.length <= 12) {
    return value;
  }
  return `${value.slice(0, 6)}...${value.slice(-6)}`;
}

export function isZeroUInt160Hash(value: string | null | undefined): boolean {
  if (!value) {
    return true;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  if (normalized === ZERO_UINT160) {
    return true;
  }

  return normalized === ZERO_UINT160.slice(2);
}

export function parseTokenSale(raw: unknown): TokenSaleState {
  if (!Array.isArray(raw) || raw.length === 0) {
    return {
      listed: false,
      seller: "",
      price: "0",
      listedAt: "",
    };
  }

  const listed = raw[0] === true;
  if (!listed) {
    return {
      listed: false,
      seller: "",
      price: "0",
      listedAt: "",
    };
  }

  return {
    listed: true,
    seller: raw[1]?.toString() ?? "",
    price: raw[2]?.toString() ?? "0",
    listedAt: raw[3]?.toString() ?? "",
  };
}

export function formatGasAmount(integerString: string): string {
  const value = integerString.trim();
  if (!/^-?\d+$/.test(value)) {
    return "0";
  }

  const negative = value.startsWith("-");
  const digits = negative ? value.slice(1) : value;
  const padded = digits.padStart(9, "0");
  const integerPart = padded.slice(0, -8).replace(/^0+(?=\d)/, "") || "0";
  const fractionalPart = padded.slice(-8).replace(/0+$/, "");

  const rendered = fractionalPart.length > 0 ? `${integerPart}.${fractionalPart}` : integerPart;
  return negative ? `-${rendered}` : rendered;
}

export function parseGasAmountToInteger(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Price is required.");
  }

  if (!/^\d+(?:\.\d{1,8})?$/.test(trimmed)) {
    throw new Error("Invalid GAS amount. Use up to 8 decimals.");
  }

  const [integerPartRaw, fractionalPartRaw = ""] = trimmed.split(".");
  const integerPart = integerPartRaw.replace(/^0+(?=\d)/, "") || "0";
  const fractionalPart = fractionalPartRaw.padEnd(8, "0");
  const combined = `${integerPart}${fractionalPart}`.replace(/^0+(?=\d)/, "") || "0";

  return combined;
}

export function isValidGasAmountInput(input: string): boolean {
  try {
    parseGasAmountToInteger(input);
    return true;
  } catch {
    return false;
  }
}

export function toIsoTime(unixSecondsText: string): string {
  const value = Number(unixSecondsText);
  if (!Number.isFinite(value) || value <= 0) {
    return "";
  }
  return new Date(value * 1000).toISOString();
}

export function tokenSerial(tokenId: string): string {
  const parts = tokenId.split(":");
  return parts.length > 1 ? parts[parts.length - 1] : tokenId;
}
