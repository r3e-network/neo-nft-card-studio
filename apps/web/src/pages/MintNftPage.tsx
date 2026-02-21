import { FormEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles, ImagePlus, Wand2 } from "lucide-react";

import { useWallet } from "../hooks/useWallet";
import { uploadToNeoFs } from "../lib/api";
import { toUserErrorMessage } from "../lib/errors";
import { getNftClientForHash, getPlatformClient } from "../lib/platformClient";
import { useRuntimeContractDialect } from "../lib/runtime-dialect";

interface MintFormState {
  collectionId: string;
  tokenUri: string;
  propertiesJson: string;
}

const DEFAULT_FORM: MintFormState = {
  collectionId: "",
  tokenUri: "",
  propertiesJson: "{}",
};

function isZeroUInt160Hex(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "0x0000000000000000000000000000000000000000" || normalized === "0000000000000000000000000000000000000000";
}

export function MintNftPage() {
  const { t } = useTranslation();
  const wallet = useWallet();
  const contractDialect = useRuntimeContractDialect();
  const [form, setForm] = useState<MintFormState>(DEFAULT_FORM);
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [ownerDedicatedCollectionId, setOwnerDedicatedCollectionId] = useState<string>("");
  const [ownerDedicatedContractHash, setOwnerDedicatedContractHash] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isCsharpDialect = contractDialect === "csharp";

  const update = <K extends keyof MintFormState>(key: K, value: MintFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  useEffect(() => {
    if (!isCsharpDialect || !wallet.address) {
      setOwnerDedicatedCollectionId("");
      setOwnerDedicatedContractHash("");
      return;
    }

    let cancelled = false;
    const loadOwnerBinding = async () => {
      try {
        const platformClient = getPlatformClient();
        const [collectionId, contractHash] = await Promise.all([
          platformClient.getOwnerDedicatedCollection(wallet.address as string),
          platformClient.getOwnerDedicatedCollectionContract(wallet.address as string),
        ]);

        if (cancelled) {
          return;
        }

        setOwnerDedicatedCollectionId(collectionId ?? "");
        setOwnerDedicatedContractHash(contractHash ?? "");
        if (collectionId) {
          setForm((prev) => ({ ...prev, collectionId }));
        }
      } catch {
        if (cancelled) {
          return;
        }
        setOwnerDedicatedCollectionId("");
        setOwnerDedicatedContractHash("");
      }
    };

    void loadOwnerBinding();

    return () => {
      cancelled = true;
    };
  }, [isCsharpDialect, wallet.address, wallet.network?.network, wallet.network?.magic]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setResult("");

    if (!wallet.address) {
      setError(t("mint.err_connect"));
      return;
    }

    if (!file) {
      setError(t("mint.err_asset"));
      return;
    }

    try {
      setSubmitting(true);
      await wallet.sync();
      const uploadRes = await uploadToNeoFs(file);

      const platformClient = getPlatformClient();
      let client = platformClient;
      let effectiveCollectionId = form.collectionId;

      if (isCsharpDialect) {
        const owner = wallet.address as string;
        const [boundCollectionId, boundContractHash] = await Promise.all([
          ownerDedicatedCollectionId
            ? Promise.resolve(ownerDedicatedCollectionId)
            : platformClient.getOwnerDedicatedCollection(owner),
          ownerDedicatedContractHash
            ? Promise.resolve(ownerDedicatedContractHash)
            : platformClient.getOwnerDedicatedCollectionContract(owner),
        ]);

        if (!boundCollectionId) {
          throw new Error(t("mint.err_dedicated_collection_missing"));
        }

        if (!boundContractHash || isZeroUInt160Hex(boundContractHash)) {
          throw new Error(t("mint.err_dedicated_contract_missing"));
        }

        effectiveCollectionId = boundCollectionId;
        client = getNftClientForHash(boundContractHash);
      }

      const payload = client.buildMintInvoke({
        collectionId: effectiveCollectionId,
        to: wallet.address,
        tokenUri: uploadRes.uri,
        propertiesJson: form.propertiesJson,
      });

      const txid = await wallet.invoke(payload);
      setResult(`${t("mint.success")} ${txid || t("app.tx_sent")}`);
      setForm(isCsharpDialect ? { ...DEFAULT_FORM, collectionId: effectiveCollectionId } : DEFAULT_FORM);
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
          <Sparkles size={24} /> {t("mint.title")}
        </h2>
        <p className="hint" style={{ marginTop: '0.25rem' }}>{t("mint.subtitle")}</p>
      </div>

      <form className="form-grid" onSubmit={onSubmit}>
        <label className="full">
          {t("mint.col_id")}
          <input
            required={!isCsharpDialect}
            value={form.collectionId}
            onChange={(event) => update("collectionId", event.target.value)}
            placeholder={t("mint.col_id_ph")}
            readOnly={isCsharpDialect}
          />
        </label>
        {isCsharpDialect ? (
          <p className="hint">
            {t("mint.dedicated_status", {
              collection: ownerDedicatedCollectionId || t("mint.dedicated_not_found"),
              contract: ownerDedicatedContractHash || t("mint.dedicated_not_deployed"),
            })}
          </p>
        ) : null}

        <label className="full">
          {t("mint.asset")}
          <div
            className="upload-area"
            onClick={() => fileInputRef.current?.click()}
            style={{
              marginTop: '0.5rem',
              padding: '2rem',
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
                <ImagePlus size={20} color="#00E599" /> {file.name} ({(file.size / 1024).toFixed(1)} KB)
              </span>
            ) : (
              <span style={{ color: '#9CA3AF', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                <ImagePlus size={24} color="#9CA3AF" />
                {t("mint.asset_ph")}
              </span>
            )}
            <input
              type="file"
              ref={fileInputRef}
              style={{ display: "none" }}
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </div>
        </label>

        <label className="full">
          {t("mint.props")} ({t("detail.optional")})
          <textarea
            value={form.propertiesJson}
            onChange={(event) => update("propertiesJson", event.target.value)}
            placeholder={t("mint.props_ph")}
            rows={4}
          />
        </label>

        <div className="full form-actions" style={{ marginTop: '2rem' }}>
          <button className="btn" disabled={submitting} type="submit" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '1rem 2rem', fontSize: '1rem' }}>
            <Wand2 size={18} />
            {submitting ? t("mint.submitting") : t("mint.submit")}
          </button>
        </div>
      </form>

      {result ? <p className="success">{result}</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}
