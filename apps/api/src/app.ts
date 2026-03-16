import cors from "cors";
import express from "express";

import { type ApiNetworkName, type ResolvedNetworkAppConfig, loadConfig } from "./config.js";
import { AppDb } from "./db.js";
import { type ApiRouteNetworkContext, createHttpRouter } from "./routes/http.js";
import { IndexerService } from "./services/indexer.js";

function buildCorsOriginResolver(configuredOrigins: string) {
  const normalized = configuredOrigins
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  const vercelOrigins = [
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .map((value) => (value.startsWith("http://") || value.startsWith("https://") ? value : `https://${value}`));

  const allowSet = new Set([...normalized, ...vercelOrigins]);

  if (allowSet.has("*")) {
    return true;
  }

  const loopbackOriginRegex = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/i;

  return (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
    if (!origin) {
      callback(null, true);
      return;
    }

    if (allowSet.has(origin) || loopbackOriginRegex.test(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`CORS origin not allowed: ${origin}`), false);
  };
}

export function createApp() {
  const config = loadConfig();
  const networkContexts: Partial<Record<ApiNetworkName, ApiRouteNetworkContext>> = {};
  const configuredNetworks = Object.keys(config.NETWORKS) as ApiNetworkName[];

  for (const network of configuredNetworks) {
    const runtime = config.NETWORKS[network];
    if (!runtime) {
      continue;
    }

    const networkConfig: ResolvedNetworkAppConfig = {
      ...config,
      NETWORK_NAME: network,
      DB_FILE: runtime.dbFile,
      NEO_RPC_URL: runtime.rpcUrl,
      NEO_CONTRACT_HASH: runtime.contractHash,
      NEO_CONTRACT_DIALECT: runtime.contractDialect,
    };

    const db = new AppDb(runtime.dbFile, config.SUPABASE_URL, config.SUPABASE_DB_KEY, network);
    const indexer = new IndexerService(networkConfig, db);

    networkContexts[network] = {
      network,
      db,
      indexer,
      config: networkConfig,
    };
  }

  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use(
    cors({
      origin: buildCorsOriginResolver(config.API_CORS_ORIGIN),
    }),
  );
  app.use("/api", createHttpRouter(networkContexts, config));

  app.get("/", (_req, res) => {
    res.json({
      status: "nft-platform-api running",
      endpoints: "/api/*",
      defaultNetwork: config.NEO_DEFAULT_NETWORK,
      availableNetworks: configuredNetworks,
      documentation: "See source code",
    });
  });

  return { app, networkContexts, config };
}
