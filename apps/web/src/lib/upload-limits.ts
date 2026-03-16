const DEFAULT_LOCAL_UPLOAD_MAX_MB = 20;
const DEFAULT_PRODUCTION_UPLOAD_MAX_MB = 3;

function parseConfiguredUploadMaxMb(): number | null {
  const raw = import.meta.env.VITE_NEOFS_UPLOAD_MAX_MB;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return null;
  }

  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.floor(parsed);
}

function resolveUploadMaxMb(): number {
  return parseConfiguredUploadMaxMb()
    ?? (import.meta.env.PROD ? DEFAULT_PRODUCTION_UPLOAD_MAX_MB : DEFAULT_LOCAL_UPLOAD_MAX_MB);
}

export const NEOFS_UPLOAD_MAX_MB = resolveUploadMaxMb();
export const NEOFS_UPLOAD_MAX_BYTES = NEOFS_UPLOAD_MAX_MB * 1024 * 1024;

export function isFileTooLarge(file: File | null | undefined): boolean {
  return !!file && file.size > NEOFS_UPLOAD_MAX_BYTES;
}

export function getUploadTooLargeMessage(): string {
  return import.meta.env.PROD
    ? `File is too large for the current deployment. Maximum supported size is ${NEOFS_UPLOAD_MAX_MB}MB.`
    : `File is too large. Maximum supported size is ${NEOFS_UPLOAD_MAX_MB}MB.`;
}
