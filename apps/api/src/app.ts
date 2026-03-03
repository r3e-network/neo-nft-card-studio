import cors from "cors";
import express from "express";
import pino from "pino";
import pinoHttp from "pino-http";

import { type ApiNetworkName, loadConfig } from "./config";
import { AppDb } from "./db";
import { type ApiRouteNetworkContext, createHttpRouter } from "./routes/http";
import { IndexerService } from "./services/indexer";

export function createApp() {
  const config = loadConfig();
  const networkContexts: Partial<Record<ApiNetworkName, ApiRouteNetworkContext>> = {};
  const configuredNetworks = Object.keys(config.NETWORKS) as ApiNetworkName[];

  for (const network of configuredNetworks) {
    const runtime = config.NETWORKS[network];
    if (!runtime) {
      continue;
    }

    const networkConfig = {
      ...config,
      DB_FILE: runtime.dbFile,
      NEO_RPC_URL: runtime.rpcUrl,
      NEO_CONTRACT_HASH: runtime.contractHash,
      NEO_CONTRACT_DIALECT: runtime.contractDialect,
    };

    const db = new AppDb(runtime.dbFile, config.SUPABASE_URL, config.SUPABASE_DB_KEY);
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
      origin: config.API_CORS_ORIGIN,
    }),
  );
  app.use(pinoHttp());

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
