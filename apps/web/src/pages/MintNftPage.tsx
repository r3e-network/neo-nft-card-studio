import { FormEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles, ImagePlus, Wand2, Info, Check, ChevronRight, X, LayoutGrid } from "lucide-react";
import { Link } from "react-router-dom";

import { useWallet } from "../hooks/useWallet";
import { fetchCollections, uploadToNeoFs } from "../lib/api";
import { toUserErrorMessage } from "../lib/errors";
import { getPlatformClient, getNftClientForHash } from "../lib/platformClient";
import { useRuntimeContractDialect } from "../lib/runtime-dialect";
import type { CollectionDto } from "../lib/types";

export function MintNftPage() {
  const { t } = useTranslation();
  const wallet = useWallet();
  const contractDialect = useRuntimeContractDialect();

  const [collections, setCollections] = useState<CollectionDto[]>([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState("");
  const [to, setTo] = useState("");
  const [tokenName, setTokenName] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [attributes, setAttributes] = useState<{ trait_type: string; value: string }[]>([]);
  
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [step, setStep] = useState(1);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTo(wallet.address || "");
  }, [wallet.address]);

  useEffect(() => {
    let alive = true;
    fetchCollections()
      .then((res) => {
        if (alive) {
          const userCols = res.filter(c => c.owner === wallet.address);
          setCollections(userCols);
          if (userCols.length > 0) setSelectedCollectionId(userCols[0].collectionId);
        }
      })
      .catch(console.error);
    return () => { alive = false; };
  }, [wallet.address]);

  const addAttribute = () => setAttributes([...attributes, { trait_type: "", value: "" }]);
  const updateAttribute = (index: number, key: 'trait_type' | 'value', value: string) => {
    const newAttrs = [...attributes];
    newAttrs[index][key] = value;
    setAttributes(newAttrs);
  };
  const removeAttribute = (index: number) => {
    setAttributes(attributes.filter((_, i) => i !== index));
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setResult("");

    if (!wallet.address) return setError(t("mint.err_connect"));
    if (!selectedCollectionId) return setError("Please select a collection first.");
    if (!file) return setError("An image or media file is required to mint.");

    const collection = collections.find(c => c.collectionId === selectedCollectionId);
    if (!collection) return setError("Invalid collection.");

    try {
      setSubmitting(true);
      await wallet.sync();

      // 1. Upload to NeoFS
      const uploadRes = await uploadToNeoFs(file);
      const neofsUri = uploadRes.uri;

      // 2. Build properties JSON conforming to GhostMarket/NEP-11 standard
      const propertiesObj = {
        name: tokenName,
        description: description,
        image: neofsUri,
        attributes: attributes.filter(a => a.trait_type && a.value)
      };
      const propertiesJson = JSON.stringify(propertiesObj);

      // 3. Determine target contract (Platform vs Dedicated)
      let client = getPlatformClient();
      let isDedicated = false;
      
      if (contractDialect === "csharp" && collection.contractHash && collection.contractHash !== "0x0000000000000000000000000000000000000000") {
        client = getNftClientForHash(collection.contractHash);
        isDedicated = true;
      }

      // 4. Build Invoke
      const payload = isDedicated && contractDialect === "csharp"
        ? client.buildMintInvoke({
            collectionId: selectedCollectionId,
            to,
            tokenUri: neofsUri,
            propertiesJson,
            operatorRef: "1",
            toRef: to,
            tokenUriRef: "2001",
            propertiesRef: "2002"
          })
        : client.buildMintInvoke(
          contractDialect === "rust" 
          ? {
            collectionId: selectedCollectionId,
            to: "",
            tokenUri: "",
            propertiesJson: "",
            toRef: "1",
            tokenUriRef: "2001",
            propertiesRef: "2002",
            operatorRef: "1"
          } : {
            collectionId: selectedCollectionId,
            to,
            tokenUri: neofsUri,
            propertiesJson
          }
        );

      const txid = await wallet.invoke(payload);
      setResult(`Success! Transaction Hash: ${txid}`);
      setStep(3);
    } catch (err) {
      setError(toUserErrorMessage(t, err));
    } finally {
      setSubmitting(false);
    }
  };

  if (!wallet.address) {
    return (
      <div className="flex-center" style={{ height: '60vh', flexDirection: 'column', gap: '1.5rem' }}>
        <Wand2 size={64} color="#2081E2" />
        <h2 style={{ fontSize: "2rem", fontWeight: 800 }}>Connect your wallet</h2>
        <p className="hint" style={{ fontSize: "1.1rem" }}>Connect your Neo N3 wallet to mint NFTs.</p>
        <button className="btn" onClick={() => wallet.connect()} style={{ background: "#2081E2", padding: "1rem 2rem", borderRadius: "12px" }}>Connect Wallet</button>
      </div>
    );
  }

  return (
    <div className="fade-in" style={{ maxWidth: "900px", margin: "0 auto", padding: "2rem 0" }}>
      <div style={{ textAlign: "center", marginBottom: "3rem" }}>
        <h1 style={{ fontSize: "3rem", fontWeight: 800, margin: "0 0 1rem" }}>Create New NFT</h1>
        <p style={{ fontSize: "1.2rem", color: "#8A939B" }}>Mint unique digital items to your collections.</p>
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
           {collections.length === 0 ? (
            <div className="panel" style={{ textAlign: "center", padding: "5rem" }}>
              <LayoutGrid size={48} color="#8A939B" style={{ marginBottom: "1rem" }} />
              <h3>No collections found</h3>
              <p className="hint">You need at least one collection to mint an NFT.</p>
              <Link className="btn" to="/collections/new" style={{ marginTop: "1.5rem", background: "#2081E2" }}>Create Collection</Link>
            </div>
          ) : (
            <div className="panel" style={{ padding: "3rem" }}>
              <div style={{ marginBottom: "2rem" }}>
                <h2 style={{ fontSize: "1.8rem", fontWeight: 700, marginBottom: "0.5rem" }}>Media & Collection</h2>
                <p style={{ color: "#8A939B" }}>Upload your artwork and choose where it belongs.</p>
              </div>

              <div className="form-grid">
                <label className="full">
                  Upload Artwork *
                  <div className="upload-area" onClick={() => fileInputRef.current?.click()} style={{ borderStyle: "dashed", padding: "4rem 2rem" }}>
                    {file ? (
                      <div className="stack-md flex-center">
                        <div style={{ width: "180px", height: "180px", borderRadius: "12px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)" }}>
                          {file.type.startsWith('image/') ? (
                            <img src={URL.createObjectURL(file)} alt="Preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          ) : (
                            <div className="flex-center" style={{ width: "100%", height: "100%", background: "#1c2638" }}>
                              <ImagePlus size={48} color="#8A939B" />
                            </div>
                          )}
                        </div>
                        <span style={{ fontWeight: 600 }}>{file.name} ({(file.size / 1024).toFixed(1)} KB)</span>
                        <span style={{ color: "#8A939B", fontSize: "0.85rem" }}>Click to replace media</span>
                      </div>
                    ) : (
                      <div className="stack-sm flex-center">
                        <ImagePlus size={48} color="#8A939B" />
                        <span style={{ fontWeight: 600, fontSize: "1.1rem" }}>Drag and drop or click to upload</span>
                        <span style={{ color: "#8A939B", fontSize: "0.85rem" }}>Supports JPG, PNG, GIF, SVG, MP4, WEBM. Max 100MB.</span>
                      </div>
                    )}
                    <input type="file" ref={fileInputRef} style={{ display: "none" }} onChange={(e) => setFile(e.target.files?.[0] || null)} />
                  </div>
                </label>

                <label className="full">
                  Select Collection *
                  <select 
                    value={selectedCollectionId} 
                    onChange={(e) => setSelectedCollectionId(e.target.value)}
                    required
                    style={{ height: "55px", background: "rgba(255,255,255,0.02)", borderRadius: "12px" }}
                  >
                    <option value="" disabled>Select a collection</option>
                    {collections.map(c => (
                      <option key={c.collectionId} value={c.collectionId}>
                        {c.name} ({c.symbol})
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "2rem" }}>
                <button 
                  className="btn" 
                  disabled={!file || !selectedCollectionId} 
                  onClick={() => setStep(2)} 
                  style={{ width: "200px", borderRadius: "12px", background: "#2081E2" }}
                >
                  Continue <ChevronRight size={20} style={{ marginLeft: "0.5rem" }} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {step === 2 && (
        <form className="stack-lg fade-in" onSubmit={onSubmit}>
          <div className="panel" style={{ padding: "3rem" }}>
            <div style={{ marginBottom: "2rem" }}>
              <h2 style={{ fontSize: "1.8rem", fontWeight: 700, marginBottom: "0.5rem" }}>Item Details</h2>
              <p style={{ color: "#8A939B" }}>Name your NFT and add traits to make it unique.</p>
            </div>

            <div className="form-grid">
              <label className="full">
                Item Name *
                <input required value={tokenName} onChange={(e) => setTokenName(e.target.value)} placeholder="e.g. Cyber Punk #001" />
              </label>

              <label className="full">
                Description
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Provide a detailed description of your item." rows={4} />
              </label>

              <div className="full" style={{ background: "rgba(255,255,255,0.02)", padding: "2rem", borderRadius: "16px", border: "1px solid rgba(255,255,255,0.1)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: "1.1rem" }}>Properties (Traits)</h3>
                    <p style={{ color: "#8A939B", fontSize: "0.85rem", margin: "0.25rem 0 0" }}>GhostMarket compatible attributes.</p>
                  </div>
                  <button type="button" className="btn btn-secondary" style={{ padding: "0.5rem 1rem", fontSize: "0.85rem", borderRadius: "10px" }} onClick={addAttribute}>
                    + Add Trait
                  </button>
                </div>
                
                {attributes.length > 0 ? (
                  <div className="stack-sm">
                    {attributes.map((attr, idx) => (
                      <div key={idx} style={{ display: "flex", gap: "1rem" }}>
                        <input 
                          placeholder="Type (e.g. Color)" 
                          value={attr.trait_type} 
                          onChange={(e) => updateAttribute(idx, 'trait_type', e.target.value)}
                          style={{ flex: 1, height: "45px" }}
                        />
                        <input 
                          placeholder="Value (e.g. Gold)" 
                          value={attr.value} 
                          onChange={(e) => updateAttribute(idx, 'value', e.target.value)}
                          style={{ flex: 1, height: "45px" }}
                        />
                        <button type="button" onClick={() => removeAttribute(idx)} style={{ background: "rgba(244, 63, 94, 0.1)", border: "none", color: "#F43F5E", borderRadius: "10px", width: "45px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <X size={18} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ textAlign: "center", padding: "1rem", color: "#8A939B", fontSize: "0.9rem", border: "1px dashed rgba(255,255,255,0.1)", borderRadius: "12px" }}>
                    No traits added yet.
                  </div>
                )}
              </div>

              <label className="full">
                Recipient Wallet Address
                <input required value={to} onChange={(e) => setTo(e.target.value)} placeholder="N..." />
                <p className="hint">Mints directly to this address. Defaults to your wallet.</p>
              </label>
            </div>

            <div style={{ display: "flex", gap: "1rem", marginTop: "3rem" }}>
              <button className="btn btn-secondary" onClick={() => setStep(1)} type="button" style={{ flex: 1, borderRadius: "12px", height: "55px" }}>Back</button>
              <button className="btn" disabled={submitting} type="submit" style={{ flex: 2, borderRadius: "12px", height: "55px", background: "#2081E2" }}>
                {submitting ? "Minting Artwork..." : "Mint Item Now"}
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
          <h2 style={{ fontSize: "2.2rem", fontWeight: 800, marginBottom: "1rem" }}>Item Minted!</h2>
          <p style={{ fontSize: "1.1rem", color: "#8A939B", marginBottom: "2rem", maxWidth: "500px", margin: "0 auto 2rem" }}>
            Your NFT has been successfully minted and uploaded to NeoFS. You can now view it in your portfolio or list it for sale.
          </p>
          <div className="panel" style={{ background: "rgba(255,255,255,0.02)", marginBottom: "3rem", padding: "1.5rem" }}>
            <p className="hint" style={{ fontSize: "0.85rem", wordBreak: "break-all" }}>{result}</p>
          </div>
          <div style={{ display: "flex", gap: "1rem", justifyContent: "center" }}>
            <Link className="btn" to="/portfolio" style={{ borderRadius: "12px", background: "#2081E2", padding: "1rem 2rem" }}>View Portfolio</Link>
            <Link className="btn btn-secondary" to="/explore" style={{ borderRadius: "12px", padding: "1rem 2rem" }}>Marketplace</Link>
          </div>
        </div>
      )}

      {error ? <p className="error" style={{ position: "fixed", bottom: "2rem", right: "2rem", maxWidth: "400px", zIndex: 100 }}>{error}</p> : null}
    </div>
  );
}
