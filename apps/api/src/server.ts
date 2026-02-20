import cors from "cors";
import express from "express";
import pino from "pino";
import pinoHttp from "pino-http";

import { type ApiNetworkName, loadConfig } from "./config";
import { AppDb } from "./db";
import { type ApiRouteNetworkContext, createHttpRouter } from "./routes/http";
import { IndexerService } from "./services/indexer";

const log = pino({ name: "nft-platform-api" });

async function main(): Promise<void> {
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

    const db = new AppDb(runtime.dbFile);
    const indexer = new IndexerService(networkConfig, db);

    networkContexts[network] = {
      network,
      db,
      indexer,
      config: networkConfig,
    };
  }

  if (configuredNetworks.length === 0) {
    throw new Error("No configured API networks. Check NEO_DEFAULT_NETWORK and NEO_* network env settings.");
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
  const server = app.listen(config.API_PORT, config.API_HOST, () => {
    log.info(
      {
        host: config.API_HOST,
        port: config.API_PORT,
        defaultNetwork: config.NEO_DEFAULT_NETWORK,
        availableNetworks: configuredNetworks,
      },
      "API server started",
    );
    for (const context of Object.values(networkContexts)) {
      context?.indexer.start();
    }
  });

  const shutdown = () => {
    log.info("Shutting down...");
    for (const context of Object.values(networkContexts)) {
      context?.indexer.stop();
      context?.db.close();
    }
    server.close(() => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
