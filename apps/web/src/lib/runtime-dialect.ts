import { useEffect, useState } from "react";

import { APP_CONFIG, type ContractDialect } from "./config";

type DialectListener = () => void;

let runtimeDialect: ContractDialect = APP_CONFIG.contractDialect;
const listeners = new Set<DialectListener>();

function notifyDialectChanged(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // ignore listener errors
    }
  }
}

function normalizeDialect(input: string): ContractDialect {
  if (input === "solidity" || input === "rust") {
    return input;
  }
  return "csharp";
}

export function setRuntimeContractDialect(input: string): void {
  const next = normalizeDialect(input);
  if (runtimeDialect === next) {
    return;
  }

  runtimeDialect = next;
  notifyDialectChanged();
}

export function resetRuntimeContractDialect(): void {
  setRuntimeContractDialect(APP_CONFIG.contractDialect);
}

export function getRuntimeContractDialect(): ContractDialect {
  return runtimeDialect;
}

export function subscribeRuntimeContractDialect(listener: DialectListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useRuntimeContractDialect(): ContractDialect {
  const [dialect, setDialect] = useState<ContractDialect>(() => getRuntimeContractDialect());

  useEffect(() => {
    return subscribeRuntimeContractDialect(() => {
      setDialect(getRuntimeContractDialect());
    });
  }, []);

  return dialect;
}
