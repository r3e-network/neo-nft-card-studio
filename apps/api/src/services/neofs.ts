import type { AppConfig } from "../config";

const NEOFS_SCHEME = /^neofs:(\/\/)?/i;

function encodePathSegments(path: string): string {
  if (!path) {
    return "";
  }

  return path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_whole, key) => values[key] ?? "");
}

export interface NeoFsParsedUri {
  originalUri: string;
  containerId: string;
  objectPath: string;
  objectId: string;
  isContainerOnly: boolean;
}

export interface NeoFsResolvedUri extends NeoFsParsedUri {
  isNeoFs: true;
  resolvedUri: string;
}

export interface NonNeoFsResolvedUri {
  originalUri: string;
  isNeoFs: false;
  resolvedUri: string;
}

export type NeoFsUriResolution = NeoFsResolvedUri | NonNeoFsResolvedUri;

export function parseNeoFsUri(uri: string): NeoFsParsedUri | null {
  const originalUri = uri.trim();
  if (!NEOFS_SCHEME.test(originalUri)) {
    return null;
  }

  const withoutScheme = originalUri.replace(NEOFS_SCHEME, "").replace(/^\/+/, "");
  const pathOnly = withoutScheme.split(/[?#]/, 1)[0] ?? "";
  const segments = pathOnly
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (segments.length === 0) {
    return null;
  }

  const containerId = segments[0];
  const objectSegments = segments.slice(1);
  const objectPath = objectSegments.join("/");
  const objectId = objectSegments.length > 0 ? objectSegments[objectSegments.length - 1] : "";

  return {
    originalUri,
    containerId,
    objectPath,
    objectId,
    isContainerOnly: objectSegments.length === 0,
  };
}

export function resolveNeoFsUri(uri: string, config: AppConfig): NeoFsUriResolution {
  const parsed = parseNeoFsUri(uri);
  if (!parsed) {
    return {
      originalUri: uri,
      isNeoFs: false,
      resolvedUri: uri,
    };
  }

  const encodedContainerId = encodeURIComponent(parsed.containerId);
  const encodedObjectPath = encodePathSegments(parsed.objectPath);
  const encodedObjectId = encodeURIComponent(parsed.objectId);

  const resolvedUri = fillTemplate(
    parsed.isContainerOnly ? config.NEOFS_CONTAINER_URL_TEMPLATE : config.NEOFS_OBJECT_URL_TEMPLATE,
    {
      containerId: encodedContainerId,
      objectPath: encodedObjectPath,
      objectId: encodedObjectId,
    },
  );

  return {
    ...parsed,
    isNeoFs: true,
    resolvedUri,
  };
}
