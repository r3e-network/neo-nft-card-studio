export async function shareOrCopyUrl(input: {
  title: string;
  url: string;
  text?: string;
}): Promise<"shared" | "copied"> {
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    await navigator.share({
      title: input.title,
      text: input.text,
      url: input.url,
    });
    return "shared";
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(input.url);
    return "copied";
  }

  throw new Error("Share is not available in this browser.");
}

export function openTwitterShare(input: {
  text: string;
  url: string;
}): void {
  if (typeof window === "undefined") {
    return;
  }

  const target = new URL("https://twitter.com/intent/tweet");
  target.searchParams.set("text", input.text);
  target.searchParams.set("url", input.url);
  window.open(target.toString(), "_blank", "noopener,noreferrer");
}

export function isHttpUrl(value: string | null | undefined): boolean {
  const normalized = value?.trim() ?? "";
  return /^https?:\/\//i.test(normalized);
}
