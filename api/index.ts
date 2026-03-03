import express from "express";
import pino from "pino";
import { createApp } from "../apps/api/src/app.js";

const log = pino({ name: "nft-platform-vercel-entry" });
let app: express.Express;

try {
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

export default app;
