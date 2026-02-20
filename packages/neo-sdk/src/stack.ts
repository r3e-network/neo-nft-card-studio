interface StackItem {
  type: string;
  value?: unknown;
  iteratorId?: string;
  truncated?: boolean;
}

function toBase64String(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    const bytes = new Uint8Array(value as number[]);
    if (typeof btoa !== "undefined") {
      let binary = "";
      bytes.forEach((byte) => {
        binary += String.fromCharCode(byte);
      });
      return btoa(binary);
    }
    if (typeof Buffer !== "undefined") {
      return Buffer.from(bytes).toString("base64");
    }
    return "";
  }

  return "";
}

function base64ToUtf8(value: string): string {
  if (!value) {
    return "";
  }

  if (typeof atob !== "undefined") {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  }

  if (typeof Buffer !== "undefined") {
    return Buffer.from(value, "base64").toString("utf-8");
  }

  return value;
}

function base64ToBytes(value: string): Uint8Array {
  if (!value) {
    return new Uint8Array();
  }

  if (typeof atob !== "undefined") {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(value, "base64"));
  }

  return new Uint8Array();
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function isLikelyUtf8Printable(text: string): boolean {
  if (!text) {
    return true;
  }
  return /^[\x09\x0A\x0D\x20-\x7E]+$/.test(text);
}

export function decodeStackItem(item: StackItem): unknown {
  switch (item.type) {
    case "Integer":
      return item.value?.toString() ?? "0";
    case "Boolean":
      return item.value === true;
    case "ByteString":
    case "Buffer": {
      const b64 = toBase64String(item.value);
      const text = base64ToUtf8(b64);
      if (isLikelyUtf8Printable(text)) {
        return text;
      }
      const bytes = base64ToBytes(b64);
      return `0x${bytesToHex(bytes)}`;
    }
    case "Array":
    case "Struct":
      return Array.isArray(item.value)
        ? (item.value as StackItem[]).map((entry) => decodeStackItem(entry))
        : [];
    case "Map":
      return Array.isArray(item.value)
        ? Object.fromEntries(
            (item.value as { key: StackItem; value: StackItem }[]).map((entry) => [
              decodeStackItem(entry.key)?.toString() ?? "",
              decodeStackItem(entry.value),
            ]),
          )
        : {};
    case "Null":
      return null;
    case "Pointer":
      return item.value;
    case "InteropInterface":
      return {
        iteratorId: item.iteratorId,
        truncated: item.truncated,
      };
    default:
      return item.value;
  }
}
