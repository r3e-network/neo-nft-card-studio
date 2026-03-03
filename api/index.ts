import express from "express";
import pino from "pino";

const log = pino({ name: "nft-platform-vercel-entry" });
let appPromise: Promise<express.Express> | null = null;

function envPresent(...values: Array<string | undefined>): boolean {
  return values.some((value) => typeof value === "string" && value.trim().length > 0);
}

function createFallbackApp(message: string): express.Express {
  const fallback = express();
  fallback.use((_req, res) => {
    const diagnostics = {
      hasNeoRpcUrl: envPresent(
        process.env.NEO_RPC_URL,
        process.env.NEO_RPC_URL_MAINNET,
        process.env.NEO_RPC_URL_TESTNET,
        process.env.NEO_RPC_URL_PRIVATE,
      ),
      hasNeoContractHash: envPresent(
        process.env.NEO_CONTRACT_HASH,
        process.env.NEO_CONTRACT_HASH_MAINNET,
        process.env.NEO_CONTRACT_HASH_TESTNET,
        process.env.NEO_CONTRACT_HASH_PRIVATE,
      ),
      hasSupabaseUrl: envPresent(
        process.env.SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_PROJECT_URL,
        process.env.POSTGRES_HOST,
        process.env.POSTGRES_USER,
        process.env.POSTGRES_URL,
      ),
      hasSupabaseKey: envPresent(
        process.env.SUPABASE_SERVICE_ROLE_KEY,
        process.env.SUPABASE_SECRET_KEY,
        process.env.SUPABASE_KEY,
        process.env.SUPABASE_ANON_KEY,
        process.env.SUPABASE_PUBLISHABLE_KEY,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      ),
      nodeVersion: process.version,
    };

    res.status(500).json({
      status: "error",
      message: "API initialization failed",
      detail: message,
      diagnostics,
    });
  });
  return fallback;
}

async function getApp(): Promise<express.Express> {
  if (!appPromise) {
    appPromise = (async () => {
      try {
        const { createApp } = await import("../apps/api/src/app.js");
        return createApp().app;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error({ err: error }, "Failed to initialize API app");
        return createFallbackApp(message);
      }
    })();
  }

  return appPromise;
}

export default async function handler(
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const resolvedApp = await getApp();
  resolvedApp(req, res);
}
