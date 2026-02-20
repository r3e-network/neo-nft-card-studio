# NeoFS Integration Guide

## 1. Goal

Allow creators to publish NFT resources with `neofs://` URIs directly from the web UI, and let the platform resolve and load them without custom contract development.

Supported URI format:

- `neofs://<containerId>/<objectPath>`
- `neofs://<containerId>` (container-level reference)

## 2. API Endpoints

- `GET /api/meta/neofs`
  - Returns NeoFS integration status and gateway templates.
- `GET /api/meta/neofs/resolve?uri=<neofs://...>`
  - Resolves a NeoFS URI to the configured HTTP gateway URL.
- `GET /api/meta/neofs/metadata?uri=<neofs://...>`
  - Fetches JSON metadata from the resolved gateway URL (server-side).
- `GET /api/meta/neofs/resource?uri=<neofs://...>`
  - Streams arbitrary NeoFS resource bytes through API proxy (image/media loading without gateway CORS issues).

## 3. Environment Variables

Configure in `.env`:

```bash
NEOFS_ENABLED=true
NEOFS_GATEWAY_BASE_URL=https://fs.neo.org
NEOFS_OBJECT_URL_TEMPLATE=https://fs.neo.org/{containerId}/{objectPath}
NEOFS_CONTAINER_URL_TEMPLATE=https://fs.neo.org/{containerId}
NEOFS_METADATA_TIMEOUT_MS=10000
```

Template placeholders:

- `{containerId}`: NeoFS container id
- `{objectPath}`: object path (joined path segments)
- `{objectId}`: last path segment (if needed by custom gateway route)

## 4. Frontend Behavior

- Collection create/update forms accept `neofs://` in `baseUri`.
- Mint form accepts `neofs://` in `tokenUri`.
- Collection detail page:
  - Resolves token URI to gateway URL.
  - Supports loading NeoFS metadata JSON per token.
  - Supports media preview from metadata (`image`, `image_url`, `animation_url`, `media`) via API proxy.
- Portfolio page:
  - `neofs://` metadata links are converted to API proxy URLs for stable browser loading.

## 5. Notes

- Smart contracts store URI strings only; NeoFS loading is handled by API + web layer.
- This keeps issuance UX simple (Pump-style configuration flow) while still producing real on-chain NFTs.
