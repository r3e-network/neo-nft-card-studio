import express from "express";
import pino from "pino";

const log = pino({ name: "nft-platform-vercel-entry" });

type HandlerRequest = Parameters<express.Express>[0];
type HandlerResponse = Parameters<express.Express>[1];

let initialized = false;
let app: express.Express | null = null;

async function ensureApp(): Promise<express.Express> {
  if (initialized && app) {
    return app;
  }

  initialized = true;

  try {
    const { createApp } = await import("../apps/api/src/app");
    ({ app } = createApp());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ err: error }, "Failed to initialize API app");

    const fallback = express();
    fallback.use((_req, res) => {
      res.status(500).json({
        status: "error",
        message: "API initialization failed",
        detail: message,
      });
    });
    app = fallback;
  }

  return app!;
}

export default async function handler(req: HandlerRequest, res: HandlerResponse) {
  const resolved = await ensureApp();
  return resolved(req, res);
}
