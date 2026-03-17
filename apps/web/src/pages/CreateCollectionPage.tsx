import { FormEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { PlusCircle, UploadCloud, Rocket, Layers, ShieldCheck, Info, ChevronRight, Check } from "lucide-react";
import { wallet as neonWallet } from "@cityofzion/neon-js";

import { useWallet } from "../hooks/useWallet";
import { uploadToNeoFs } from "../lib/api";
import { toUserErrorMessage } from "../lib/errors";
import { cachePendingCollectionFromTx } from "../lib/pending-collections";
import { getPlatformClient } from "../lib/platformClient";
import { useRuntimeContractDialect } from "../lib/runtime-dialect";
import { useRuntimeNetworkState } from "../lib/runtime-network";
import { getUploadTooLargeMessage, isFileTooLarge, NEOFS_UPLOAD_MAX_MB } from "../lib/upload-limits";

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
};

export function CreateCollectionPage() {
  const { t } = useTranslation();
  const wallet = useWallet();
  const contractDialect = useRuntimeContractDialect();
  const runtimeNetwork = useRuntimeNetworkState();
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [step, setStep] = useState(1);
  const [dedicatedModeStatus, setDedicatedModeStatus] = useState<"checking" | "available" | "unavailable" | "unsupported">(
    contractDialect === "csharp" ? "checking" : "unsupported",
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  useEffect(() => {
    let cancelled = false;

    if (contractDialect !== "csharp") {
      setDedicatedModeStatus("unsupported");
      return () => {
        cancelled = true;
      };
    }

    setDedicatedModeStatus("checking");
    void (async () => {
      try {
        const client = getPlatformClient();
        const [templateReady, templateSegmentsReady] = await Promise.all([
          client.hasCollectionContractTemplate(),
          client.hasCollectionContractTemplateNameSegments().catch(() => false),
        ]);

        if (!cancelled) {
          setDedicatedModeStatus(templateReady && templateSegmentsReady ? "available" : "unavailable");
        }
      } catch {
        if (!cancelled) {
          setDedicatedModeStatus("unavailable");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [contractDialect, runtimeNetwork.runtimeKey]);

  useEffect(() => {
    if (form.mode !== "dedicated") {
      return;
    }

    if (dedicatedModeStatus === "unavailable" || dedicatedModeStatus === "unsupported") {
      setForm((prev) => ({ ...prev, mode: "shared" }));
    }
  }, [dedicatedModeStatus, form.mode]);

  const dedicatedModeSelectable = dedicatedModeStatus === "available";
  const dedicatedModeMessage = contractDialect !== "csharp"
    ? "C# Dialect required"
    : dedicatedModeStatus === "checking"
      ? "Checking dedicated template..."
      : dedicatedModeStatus === "unavailable"
        ? "Not configured on this network"
        : null;

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setResult("");

    if (!wallet.address) {
      setError("Please connect your wallet first.");
      return;
    }

    if (!form.name || !form.symbol) {
      setError("Name and symbol are required.");
      return;
    }

    if (isFileTooLarge(file)) {
      setError(getUploadTooLargeMessage());
      return;
    }

    try {
      setSubmitting(true);
      const session = await wallet.sync();
      const activeAddress = session.address?.trim() || "";
      if (!activeAddress) {
        throw new Error("Wallet session is unavailable. Please reconnect wallet.");
      }
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
          throw new Error("Dedicated contract template is not configured on this network.");
        }
      }

      const payload = form.mode === "dedicated" 
        ? client.buildCreateCollectionAndDeployFromTemplateInvoke({
            name: form.name,
            symbol: form.symbol,
            description: form.description,
            baseUri: neofsUri,
            maxSupply: form.maxSupply,
            royaltyBps: Number(form.royaltyBps),
            transferable: form.transferable,
            extraData: JSON.parse(form.extraDataJson),
          })
        : client.buildCreateCollectionInvoke({
            name: form.name,
            symbol: form.symbol,
            description: form.description,
            baseUri: neofsUri,
            maxSupply: form.maxSupply,
            royaltyBps: Number(form.royaltyBps),
            transferable: form.transferable
          });

      if (form.mode === "dedicated") {
        payload.signers = [
          {
            account: neonWallet.getScriptHashFromAddress(wallet.address),
            scopes: "Global",
          },
        ];
      }

      const txid = await wallet.invoke(payload);
      if (import.meta.env.DEV) {
        console.log(`SUBMITTED_TXID_FOR_PLAYWRIGHT_E2E=${txid}`);
      }
      await cachePendingCollectionFromTx({
        txid,
        owner: activeAddress,
        fallback: {
          name: form.name,
          symbol: form.symbol,
          description: form.description,
          baseUri: neofsUri,
          maxSupply: form.maxSupply,
          royaltyBps: Number(form.royaltyBps),
          transferable: form.transferable,
        },
      }).catch(() => null);
      setResult(`Collection transaction submitted. Transaction Hash: ${txid}`);
      setStep(3);
    } catch (err) {
      setError(toUserErrorMessage(t, err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fade-in" style={{ maxWidth: "1000px", margin: "0 auto", padding: "2rem 0" }}>
      <div style={{ textAlign: "center", marginBottom: "3rem" }}>
        <h1 style={{ fontSize: "3rem", fontWeight: 800, margin: "0 0 1rem" }}>Create a Collection</h1>
        <p style={{ fontSize: "1.2rem", color: "#8A939B" }}>Launch your NFT collection on Neo N3 in minutes.</p>
      </div>

      {/* Stepper */}
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "1rem", marginBottom: "3rem" }}>
        {[1, 2, 3].map(i => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <div style={{ 
              width: "40px", 
              height: "40px", 
              borderRadius: "50%", 
              display: "flex", 
              alignItems: "center", 
              justifyContent: "center",
              background: step >= i ? "#2081E2" : "rgba(255,255,255,0.1)",
              color: "#fff",
              fontWeight: 700,
              fontSize: "1.1rem"
            }}>
              {step > i ? <Check size={20} /> : i}
            </div>
            {i < 3 && <div style={{ width: "60px", height: "2px", background: step > i ? "#2081E2" : "rgba(255,255,255,0.1)" }}></div>}
          </div>
        ))}
      </div>

      {step === 1 && (
        <div className="stack-lg fade-in">
          <div style={{ textAlign: "center" }}>
            <h2 style={{ fontSize: "1.8rem", fontWeight: 700, marginBottom: "2rem" }}>Choose your deployment mode</h2>
          </div>
          
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem" }}>
            <div 
              onClick={() => update("mode", "shared")}
              style={{ 
                padding: "2.5rem", 
                borderRadius: "24px", 
                cursor: "pointer",
                border: form.mode === "shared" ? "2px solid #2081E2" : "2px solid rgba(255, 255, 255, 0.1)",
                background: form.mode === "shared" ? "rgba(32, 129, 226, 0.05)" : "rgba(255, 255, 255, 0.02)",
                transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                position: "relative"
              }}
              onMouseOver={(e) => !form.mode.includes("shared") && (e.currentTarget.style.borderColor = "rgba(32, 129, 226, 0.5)")}
              onMouseOut={(e) => e.currentTarget.style.borderColor = form.mode === "shared" ? "#2081E2" : "rgba(255, 255, 255, 0.1)"}
            >
              {form.mode === "shared" && <div style={{ position: "absolute", top: "1.5rem", right: "1.5rem", background: "#2081E2", borderRadius: "50%", padding: "4px" }}><Check size={16} /></div>}
              <Layers size={40} color="#2081E2" style={{ marginBottom: "1.5rem" }} />
              <h3 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "1rem" }}>Shared Storefront</h3>
              <p style={{ color: "#8A939B", lineHeight: 1.6, marginBottom: "1.5rem" }}>
                Perfect for getting started. Your collection lives on our optimized platform contract.
              </p>
              <ul style={{ padding: 0, margin: 0, listStyle: "none", color: "#8A939B", fontSize: "0.95rem" }}>
                <li style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}><Check size={16} color="#00E599" /> Free to deploy</li>
                <li style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}><Check size={16} color="#00E599" /> Instant setup</li>
                <li style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}><Check size={16} color="#00E599" /> Low gas fees for minting</li>
              </ul>
            </div>

            <div 
              onClick={() => {
                if (dedicatedModeSelectable) {
                  update("mode", "dedicated");
                }
              }}
              style={{ 
                padding: "2.5rem", 
                borderRadius: "24px", 
                cursor: dedicatedModeSelectable ? "pointer" : "not-allowed",
                border: form.mode === "dedicated" ? "2px solid #00E599" : "2px solid rgba(255, 255, 255, 0.1)",
                background: form.mode === "dedicated" ? "rgba(0, 229, 153, 0.05)" : "rgba(255, 255, 255, 0.02)",
                transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                position: "relative",
                opacity: dedicatedModeSelectable ? 1 : 0.6,
                pointerEvents: dedicatedModeSelectable ? "auto" : "none"
              }}
              onMouseOver={(e) => dedicatedModeSelectable && !form.mode.includes("dedicated") && (e.currentTarget.style.borderColor = "rgba(0, 229, 153, 0.5)")}
              onMouseOut={(e) => e.currentTarget.style.borderColor = form.mode === "dedicated" ? "#00E599" : "rgba(255, 255, 255, 0.1)"}
            >
              {form.mode === "dedicated" && <div style={{ position: "absolute", top: "1.5rem", right: "1.5rem", background: "#00E599", borderRadius: "50%", padding: "4px" }}><Check size={16} /></div>}
              <ShieldCheck size={40} color="#00E599" style={{ marginBottom: "1.5rem" }} />
              <h3 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "1rem" }}>Dedicated Contract</h3>
              <p style={{ color: "#8A939B", lineHeight: 1.6, marginBottom: "1.5rem" }}>
                For professional creators. Your own smart contract for maximum independence.
              </p>
              <ul style={{ padding: 0, margin: 0, listStyle: "none", color: "#8A939B", fontSize: "0.95rem" }}>
                <li style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}><Check size={16} color="#00E599" /> 10 GAS one-time fee</li>
                <li style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}><Check size={16} color="#00E599" /> Unique contract hash</li>
                <li style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}><Check size={16} color="#00E599" /> Full ownership & isolation</li>
              </ul>
              {dedicatedModeMessage && (
                <div style={{ marginTop: "1rem", color: "#F43F5E", fontSize: "0.85rem", fontWeight: 600 }}>
                  {dedicatedModeMessage}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "center", marginTop: "2rem" }}>
            <button className="btn" onClick={() => setStep(2)} style={{ width: "240px", borderRadius: "12px", background: "#2081E2", fontSize: "1.1rem" }}>
              Continue <ChevronRight size={20} style={{ marginLeft: "0.5rem" }} />
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <form className="stack-lg fade-in" onSubmit={onSubmit}>
           <div className="panel" style={{ padding: "3rem" }}>
              <div style={{ marginBottom: "2rem" }}>
                <h2 style={{ fontSize: "1.8rem", fontWeight: 700, marginBottom: "0.5rem" }}>Collection Details</h2>
                <p style={{ color: "#8A939B" }}>Configure the metadata and settings for your new collection.</p>
              </div>

              <div className="form-grid">
                <div className="full">
                  <span style={{ fontSize: "0.9rem", fontWeight: 500, color: "var(--text-muted)", display: "block", marginBottom: "0.25rem" }}>Logo Image</span>
                  <div className="upload-area" onClick={() => fileInputRef.current?.click()} style={{ borderStyle: "dashed", padding: "3rem" }}>
                    {file ? (
                      <div className="stack-sm flex-center">
                        <Check size={32} color="#00E599" />
                        <span style={{ fontWeight: 600 }}>{file.name}</span>
                        <span style={{ color: "#8A939B", fontSize: "0.85rem" }}>Click to change</span>
                      </div>
                    ) : (
                      <div className="stack-sm flex-center">
                        <UploadCloud size={32} color="#8A939B" />
                        <span style={{ fontWeight: 600 }}>Upload logo</span>
                        <span style={{ color: "#8A939B", fontSize: "0.85rem" }}>Recommended size: 350 x 350. Max {NEOFS_UPLOAD_MAX_MB}MB.</span>
                      </div>
                    )}
                    <input
                      type="file"
                      ref={fileInputRef}
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const nextFile = e.target.files?.[0] || null;
                        if (isFileTooLarge(nextFile)) {
                          setError(getUploadTooLargeMessage());
                          setFile(null);
                          e.currentTarget.value = "";
                          return;
                        }
                        setError("");
                        setFile(nextFile);
                      }}
                    />
                  </div>
                </div>

                <label>
                  Collection Name *
                  <input required value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="e.g. Neo Genesis" />
                </label>

                <label>
                  Symbol *
                  <input required value={form.symbol} onChange={(e) => update("symbol", e.target.value.toUpperCase())} placeholder="e.g. NGEN" maxLength={12} />
                </label>

                <label className="full">
                  Description
                  <textarea value={form.description} onChange={(e) => update("description", e.target.value)} placeholder="Tell the world about your collection..." rows={4} />
                </label>

                <label>
                  Max Supply
                  <input type="number" min={0} value={form.maxSupply} onChange={(e) => update("maxSupply", e.target.value)} />
                  <p className="hint" style={{ marginTop: "0.4rem", fontSize: "0.8rem" }}>0 = Unlimited supply</p>
                </label>

                <label>
                  Royalty Percentage (%)
                  <input type="number" min={0} max={100} value={Number(form.royaltyBps) / 100} onChange={(e) => update("royaltyBps", (Number(e.target.value) * 100).toString())} />
                  <p className="hint" style={{ marginTop: "0.4rem", fontSize: "0.8rem" }}>Basis points (BPS): {form.royaltyBps}</p>
                </label>

                <label className="switch full" style={{ marginTop: "1rem" }}>
                  <input type="checkbox" checked={form.transferable} onChange={(e) => update("transferable", e.target.checked)} />
                  <span style={{ fontSize: "1rem", fontWeight: 600 }}>Allow transfers between wallets</span>
                  <Info size={16} color="#8A939B" style={{ marginLeft: "0.5rem" }} />
                </label>

                {form.mode === "dedicated" && (
                  <label className="full" style={{ marginTop: "1rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                      Dedicated Extra Data (JSON)
                      <ShieldCheck size={16} color="#00E599" />
                    </div>
                    <textarea value={form.extraDataJson} onChange={(e) => update("extraDataJson", e.target.value)} rows={3} style={{ fontFamily: "monospace", fontSize: "0.85rem" }} />
                  </label>
                )}
              </div>

              <div style={{ display: "flex", gap: "1rem", marginTop: "3rem" }}>
                <button className="btn btn-secondary" onClick={() => setStep(1)} type="button" style={{ flex: 1, borderRadius: "12px", height: "55px" }}>Back</button>
                <button className="btn" disabled={submitting} type="submit" style={{ flex: 2, borderRadius: "12px", height: "55px", background: "#2081E2" }}>
                  {submitting ? "Launching..." : `Launch Collection ${form.mode === "dedicated" ? "(10 GAS)" : "(Free)"}`}
                </button>
              </div>
           </div>
        </form>
      )}

      {step === 3 && (
        <div className="panel fade-in" style={{ textAlign: "center", padding: "5rem" }}>
          <div style={{ 
            width: "80px", 
            height: "80px", 
            borderRadius: "50%", 
            background: "#00E599", 
            display: "flex", 
            alignItems: "center", 
            justifyContent: "center",
            margin: "0 auto 2rem"
          }}>
            <Check size={48} color="#fff" />
          </div>
          <h2 style={{ fontSize: "2.2rem", fontWeight: 800, marginBottom: "1rem" }}>Collection Transaction Submitted</h2>
          <p style={{ fontSize: "1.1rem", color: "#8A939B", marginBottom: "2rem", maxWidth: "500px", margin: "0 auto 2rem" }}>
            Your collection creation transaction has been submitted to Neo N3. Wait for wallet/network confirmation and a short indexing delay before expecting it to appear everywhere in the app.
          </p>
          <div className="panel" style={{ background: "rgba(255,255,255,0.02)", marginBottom: "3rem", padding: "1.5rem" }}>
            <p className="hint" style={{ fontSize: "0.85rem", wordBreak: "break-all" }}>{result}</p>
          </div>
          <div style={{ display: "flex", gap: "1rem", justifyContent: "center" }}>
            <Link className="btn" to="/portfolio" style={{ borderRadius: "12px", background: "#2081E2", padding: "1rem 2rem" }}>View Portfolio</Link>
            <Link className="btn btn-secondary" to="/explore" style={{ borderRadius: "12px", padding: "1rem 2rem" }}>Explore Marketplace</Link>
          </div>
        </div>
      )}

      {error ? <p className="error" style={{ position: "fixed", bottom: "2rem", right: "2rem", maxWidth: "400px", zIndex: 100 }}>{error}</p> : null}
    </div>
  );
}
