import { FormEvent, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { PlusCircle, UploadCloud, Rocket, Layers, ShieldCheck } from "lucide-react";

import { useWallet } from "../hooks/useWallet";
import { uploadToNeoFs } from "../lib/api";
import { toUserErrorMessage } from "../lib/errors";
import { getPlatformClient } from "../lib/platformClient";
import { useRuntimeContractDialect } from "../lib/runtime-dialect";

interface FormState {
  mode: "shared" | "dedicated";
  name: string;
  symbol: string;
  description: string;
  baseUri: string;
  maxSupply: string;
  royaltyBps: string;
  transferable: boolean;
  extraDataJson: string;
  creatorRef: string;
  nameRef: string;
  symbolRef: string;
  descriptionRef: string;
  baseUriRef: string;
}

const DEFAULT_FORM: FormState = {
  mode: "shared",
  name: "",
  symbol: "",
  description: "",
  baseUri: "",
  maxSupply: "0",
  royaltyBps: "500",
  transferable: true,
  extraDataJson: '{"mode":"per-user-dedicated","source":"web-console"}',
  creatorRef: "1",
  nameRef: "1001",
  symbolRef: "1002",
  descriptionRef: "1003",
  baseUriRef: "1004",
};

export function CreateCollectionPage() {
  const { t } = useTranslation();
  const wallet = useWallet();
  const contractDialect = useRuntimeContractDialect();
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string>("");
  const [error, setError] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setResult("");

    if (!wallet.address) {
      setError(t("create.err_connect"));
      return;
    }

    if (!form.baseUri && !file) {
      setError(t("create.err_cover"));
      return;
    }

    try {
      setSubmitting(true);
      await wallet.sync();
      let neofsUri = form.baseUri;
      if (file) {
        const uploadRes = await uploadToNeoFs(file);
        neofsUri = uploadRes.uri;
      }

      const client = getPlatformClient();
      if (contractDialect === "csharp" && form.mode === "dedicated") {
        const [templateReady, templateSegmentsReady] = await Promise.all([
          client.hasCollectionContractTemplate(),
          client.hasCollectionContractTemplateNameSegments().catch(() => false),
        ]);

        if (!templateReady || !templateSegmentsReady) {
          throw new Error(t("create.err_template_not_ready"));
        }
      }

      const payload =
        contractDialect === "csharp"
          ? (() => {
              if (form.mode === "dedicated") {
                const trimmed = form.extraDataJson.trim();
                let extraData: unknown = null;
                if (trimmed.length > 0) {
                  try {
                    extraData = JSON.parse(trimmed);
                  } catch {
                    throw new Error(t("create.err_extra_json"));
                  }
                }

                return client.buildCreateCollectionAndDeployFromTemplateInvoke({
                  name: form.name,
                  symbol: form.symbol,
                  description: form.description,
                  baseUri: neofsUri,
                  maxSupply: form.maxSupply,
                  royaltyBps: Number(form.royaltyBps),
                  transferable: form.transferable,
                  extraData: extraData as
                    | string
                    | number
                    | boolean
                    | null
                    | Array<unknown>
                    | Record<string, unknown>,
                });
              } else {
                return client.buildCreateCollectionInvoke({
                  name: form.name,
                  symbol: form.symbol,
                  description: form.description,
                  baseUri: neofsUri,
                  maxSupply: form.maxSupply,
                  royaltyBps: Number(form.royaltyBps),
                  transferable: form.transferable
                });
              }
            })()
          : client.buildCreateCollectionInvoke({
              name: form.name,
              symbol: form.symbol,
              description: form.description,
              baseUri: neofsUri,
              maxSupply: form.maxSupply,
              royaltyBps: Number(form.royaltyBps),
              transferable: form.transferable,
              creatorRef: form.creatorRef,
              nameRef: form.nameRef,
              symbolRef: form.symbolRef,
              descriptionRef: form.descriptionRef,
              baseUriRef: form.baseUriRef,
            });

      const txid = await wallet.invoke(payload);
      const successPrefix = contractDialect === "csharp" && form.mode === "dedicated" 
        ? t("create.success_dedicated") 
        : t("create.success");
      setResult(`${successPrefix} ${txid || t("app.tx_sent")}`);
      setForm({ ...DEFAULT_FORM, mode: form.mode });
      setFile(null);
    } catch (err) {
      setError(toUserErrorMessage(t, err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="panel fade-in">
      <div className="panel-header mb-md pb-sm">
        <h2 className="flex-align-center gap-md">
          <PlusCircle size={24} /> Create a New Collection
        </h2>
        <p className="hint mt-xs">Launch your NFTs on the Neo N3 network</p>
      </div>

      <form className="form-grid" onSubmit={onSubmit}>
        <div className="full" style={{ marginBottom: '1.5rem' }}>
          <label style={{ marginBottom: '0.75rem', display: 'block', fontSize: '1rem', color: '#fff' }}>Deployment Mode</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div 
              onClick={() => update("mode", "shared")}
              style={{ 
                padding: '1.5rem', borderRadius: '16px', cursor: 'pointer',
                border: form.mode === 'shared' ? '2px solid var(--neo-green)' : '2px solid var(--glass-border)',
                background: form.mode === 'shared' ? 'rgba(0, 229, 153, 0.05)' : 'rgba(255, 255, 255, 0.02)',
                transition: 'all 0.2s ease'
              }}
            >
              <h3 className="flex-align-center gap-md" style={{ margin: '0 0 0.5rem', color: form.mode === 'shared' ? 'var(--neo-green)' : '#fff' }}>
                <Layers size={20} /> Shared Storefront
              </h3>
              <p className="hint mb-0">Free to create. NFTs are minted on the platform's multi-tenant smart contract, distinguished by collection ID. Perfect for getting started.</p>
            </div>
            
            <div 
              onClick={() => update("mode", "dedicated")}
              style={{ 
                padding: '1.5rem', borderRadius: '16px', cursor: 'pointer',
                border: form.mode === 'dedicated' ? '2px solid var(--r3e-cyan)' : '2px solid var(--glass-border)',
                background: form.mode === 'dedicated' ? 'rgba(0, 212, 255, 0.05)' : 'rgba(255, 255, 255, 0.02)',
                opacity: contractDialect === "csharp" ? 1 : 0.5,
                pointerEvents: contractDialect === "csharp" ? 'auto' : 'none',
                transition: 'all 0.2s ease'
              }}
            >
              <h3 className="flex-align-center gap-md" style={{ margin: '0 0 0.5rem', color: form.mode === 'dedicated' ? 'var(--r3e-cyan)' : '#fff' }}>
                <ShieldCheck size={20} /> Dedicated Contract
              </h3>
              <p className="hint mb-0">Costs 10 GAS. A fully isolated NEP-11 smart contract deployed exclusively for you. Best for established creators and full control.</p>
              {contractDialect !== "csharp" && <p className="error" style={{ padding: '0.5rem', marginTop: '0.5rem' }}>Only available on C# Dialect</p>}
            </div>
          </div>
        </div>

        <label>
          {t("create.col_name")}
          <input
            required
            value={form.name}
            onChange={(event) => update("name", event.target.value)}
            placeholder={t("create.col_name_ph")}
          />
        </label>

        <label>
          {t("create.symbol")}
          <input
            required
            value={form.symbol}
            onChange={(event) => update("symbol", event.target.value.toUpperCase())}
            placeholder={t("create.symbol_ph")}
            maxLength={12}
          />
        </label>

        <label className="full">
          {t("create.desc")}
          <textarea
            required
            value={form.description}
            onChange={(event) => update("description", event.target.value)}
            placeholder={t("create.desc_ph")}
            rows={3}
          />
        </label>

        <label className="full">
          {t("create.cover")}
          <div
            className="upload-area"
            onClick={() => fileInputRef.current?.click()}
          >
            {file ? (
              <span className="text-white font-semibold flex-center gap-md">
                <UploadCloud size={20} color="#00E599" /> {file.name} ({(file.size / 1024).toFixed(1)} KB)
              </span>
            ) : (
              <span className="text-muted flex-center flex-col gap-md">
                <UploadCloud size={24} color="#9CA3AF" />
                {t("create.cover_ph")}
              </span>
            )}
            <input
              type="file"
              ref={fileInputRef}
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0] || null;
                setFile(f);
                if (!f) update("baseUri", "");
              }}
            />
          </div>
        </label>

        <label>
          {t("create.max_supply")}
          <p className="hint">{t("create.max_supply_hint")}</p>
          <input
            required
            type="number"
            min={0}
            value={form.maxSupply}
            onChange={(event) => update("maxSupply", event.target.value)}
          />
        </label>

        <label>
          {t("create.royalty")}
          <input
            required
            type="number"
            min={0}
            max={10000}
            value={form.royaltyBps}
            onChange={(event) => update("royaltyBps", event.target.value)}
          />
        </label>

        <label className="switch full">
          <input
            type="checkbox"
            checked={form.transferable}
            onChange={(event) => update("transferable", event.target.checked)}
          />
          <span>{t("create.transferable")}</span>
        </label>

        {contractDialect === "csharp" && form.mode === "dedicated" ? (
          <label className="full">
            {t("create.dedicated_extra_label")}
            <textarea
              rows={3}
              value={form.extraDataJson}
              onChange={(event) => update("extraDataJson", event.target.value)}
              placeholder='{"mode":"per-user-dedicated","tag":"creator-001"}'
            />
          </label>
        ) : null}

        <div className="full form-actions mt-md">
          <button className="btn flex-align-center gap-md btn-lg" disabled={submitting} type="submit">
            <Rocket size={18} />
            {submitting ? t("create.submitting") : t("create.submit")}
          </button>
        </div>
      </form>

      {result ? <p className="success mt-md">{result}</p> : null}
      {error ? <p className="error mt-md">{error}</p> : null}
    </section>
  );
}
