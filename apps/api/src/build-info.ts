import { execSync } from "node:child_process";

function resolveRevision(): string {
  const fromEnv = process.env.VERCEL_GIT_COMMIT_SHA?.trim();
  if (fromEnv) {
    return fromEnv.slice(0, 7);
  }

  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

export const API_BUILD_INFO = {
  revision: resolveRevision(),
  builtAt: new Date().toISOString(),
};
