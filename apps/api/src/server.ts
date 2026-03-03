import pino from "pino";
import { createApp } from "./app.js";

const log = pino({ name: "nft-platform-api-server" });

async function main(): Promise<void> {
  const { app, networkContexts, config } = createApp();
  const configuredNetworks = Object.keys(networkContexts);

  const server = app.listen(config.API_PORT, config.API_HOST, () => {
    log.info(
      {
        host: config.API_HOST,
        port: config.API_PORT,
        defaultNetwork: config.NEO_DEFAULT_NETWORK,
        availableNetworks: configuredNetworks,
      },
      "API server started (standalone mode)",
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
