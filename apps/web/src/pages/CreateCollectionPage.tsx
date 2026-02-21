import { FormEvent, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { PlusCircle, UploadCloud, Rocket } from "lucide-react";

import { useWallet } from "../hooks/useWallet";
import { uploadToNeoFs } from "../lib/api";
import { toUserErrorMessage } from "../lib/errors";
import { getPlatformClient } from "../lib/platformClient";
import { useRuntimeContractDialect } from "../lib/runtime-dialect";

interface FormState {
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
      const payload =
        contractDialect === "csharp"
          ? (() => {
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
      const successPrefix = contractDialect === "csharp" ? t("create.success_dedicated") : t("create.success");
      setResult(`${successPrefix} ${txid || t("app.tx_sent")}`);
      setForm(DEFAULT_FORM);
      setFile(null);
    } catch (err) {
      setError(toUserErrorMessage(t, err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="panel fade-in">
      <div className="panel-header" style={{ marginBottom: '1.5rem', paddingBottom: '1rem' }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <PlusCircle size={24} /> {t("create.title")}
        </h2>
        <p className="hint" style={{ marginTop: '0.25rem' }}>{t("create.subtitle")}</p>
      </div>

      {contractDialect === "rust" ? (
        <p className="hint">
          {t("create.rust_hint")}
        </p>
      ) : null}

      {contractDialect === "csharp" ? (
        <p className="hint">
          {t("create.csharp_hint")}
        </p>
      ) : null}

      <form className="form-grid" onSubmit={onSubmit}>
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
            style={{
              marginTop: '0.5rem',
              padding: '2.5rem',
              border: '2px dashed rgba(0, 229, 153, 0.3)',
              borderRadius: '12px',
              textAlign: 'center',
              cursor: 'pointer',
              background: 'rgba(11, 14, 20, 0.8)',
              transition: 'all 0.3s ease'
            }}
            onMouseOver={(e) => e.currentTarget.style.borderColor = 'rgba(0, 229, 153, 0.8)'}
            onMouseOut={(e) => e.currentTarget.style.borderColor = 'rgba(0, 229, 153, 0.3)'}
          >
            {file ? (
              <span style={{ color: '#fff', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                <UploadCloud size={20} color="#00E599" /> {file.name} ({(file.size / 1024).toFixed(1)} KB)
              </span>
            ) : (
              <span style={{ color: '#9CA3AF', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
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

        {contractDialect === "csharp" ? (
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

        {contractDialect === "rust" ? (
          <>
            <label>
              {t("create.lbl_creator_ref")}
              <input
                required
                type="number"
                value={form.creatorRef}
                onChange={(event) => update("creatorRef", event.target.value)}
              />
            </label>
            <label>
              {t("create.lbl_name_ref")}
              <input
                required
                type="number"
                value={form.nameRef}
                onChange={(event) => update("nameRef", event.target.value)}
              />
            </label>
            <label>
              {t("create.lbl_symbol_ref")}
              <input
                required
                type="number"
                value={form.symbolRef}
                onChange={(event) => update("symbolRef", event.target.value)}
              />
            </label>
            <label>
              {t("create.lbl_description_ref")}
              <input
                required
                type="number"
                value={form.descriptionRef}
                onChange={(event) => update("descriptionRef", event.target.value)}
              />
            </label>
            <label className="full">
              {t("create.lbl_base_uri_ref")}
              <input
                required
                type="number"
                value={form.baseUriRef}
                onChange={(event) => update("baseUriRef", event.target.value)}
              />
            </label>
          </>
        ) : null}

        <div className="full form-actions" style={{ marginTop: '2rem' }}>
          <button className="btn" disabled={submitting} type="submit" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '1rem 2rem', fontSize: '1rem' }}>
            <Rocket size={18} />
            {submitting ? t("create.submitting") : t("create.submit")}
          </button>
        </div>
      </form>

      {result ? <p className="success">{result}</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}
