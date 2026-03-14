export const NEOFS_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
export const NEOFS_UPLOAD_MAX_MB = 20;

export function isFileTooLarge(file: File | null | undefined): boolean {
  return !!file && file.size > NEOFS_UPLOAD_MAX_BYTES;
}

export function getUploadTooLargeMessage(): string {
  return `File is too large. Maximum supported size is ${NEOFS_UPLOAD_MAX_MB}MB.`;
}
