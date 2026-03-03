import { FormEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles, ImagePlus, Wand2 } from "lucide-react";

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
      setResult(`${t("mint.success")} ${txid}`);
      setTokenName("");
      setDescription("");
      setFile(null);
      setAttributes([]);
    } catch (err) {
      setError(toUserErrorMessage(t, err));
    } finally {
      setSubmitting(false);
    }
  };

  if (!wallet.address) {
    return (
      <div className="flex-center" style={{ height: '60vh', flexDirection: 'column', gap: '1rem' }}>
        <Wand2 size={48} color="#9CA3AF" />
        <h2 style={{ margin: 0 }}>Connect your wallet</h2>
        <p className="text-muted">Connect your Neo N3 wallet to mint NFTs.</p>
        <button className="btn" onClick={() => wallet.connect()}>Connect Wallet</button>
      </div>
    );
  }

  return (
    <div className="container" style={{ maxWidth: '800px' }}>
      <section className="panel fade-in">
        <div className="panel-header mb-md pb-sm">
          <h2 className="flex-align-center gap-md">
            <Sparkles size={24} color="var(--r3e-cyan)" /> Create New Item
          </h2>
          <p className="hint mt-xs">Mint a new NFT into one of your collections</p>
        </div>

        {collections.length === 0 ? (
          <div className="text-center" style={{ padding: '3rem 1rem' }}>
            <p className="text-muted mb-sm">You need a collection to mint an NFT.</p>
            <button className="btn" onClick={() => window.location.href='/collections/new'}>Create Collection</button>
          </div>
        ) : (
          <form className="form-grid" onSubmit={onSubmit}>
            
            <label className="full">
              Upload Media *
              <p className="hint">File types supported: JPG, PNG, GIF, SVG, MP4, WEBM. Max size: 100 MB</p>
              <div
                className="upload-area"
                onClick={() => fileInputRef.current?.click()}
                style={{ padding: file ? '2rem' : '4rem 2rem' }}
              >
                {file ? (
                  <div className="flex-center flex-col gap-md">
                    <div style={{ width: '120px', height: '120px', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--glass-border)' }}>
                      {file.type.startsWith('image/') ? (
                        <img src={URL.createObjectURL(file)} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <div className="flex-center" style={{ width: '100%', height: '100%', background: 'var(--bg-main)' }}>
                          <ImagePlus size={32} color="#9CA3AF" />
                        </div>
                      )}
                    </div>
                    <span className="text-white font-semibold">
                      {file.name} ({(file.size / 1024).toFixed(1)} KB)
                    </span>
                    <span className="text-muted" style={{ fontSize: '0.9rem' }}>Click to change</span>
                  </div>
                ) : (
                  <span className="text-muted flex-center flex-col gap-md">
                    <ImagePlus size={32} color="#9CA3AF" />
                    Drag & drop file or click to browse
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
              Collection *
              <select 
                value={selectedCollectionId} 
                onChange={(e) => setSelectedCollectionId(e.target.value)}
                required
                style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', background: 'var(--bg-main)', border: '1px solid var(--glass-border)', color: '#fff' }}
              >
                <option value="" disabled>Select a collection</option>
                {collections.map(c => (
                  <option key={c.collectionId} value={c.collectionId}>
                    {c.name} ({c.symbol})
                  </option>
                ))}
              </select>
            </label>

            <label className="full">
              Name *
              <input
                required
                value={tokenName}
                onChange={(e) => setTokenName(e.target.value)}
                placeholder="Item Name"
              />
            </label>

            <label className="full">
              Description
              <p className="hint">The description will be included on the item's detail page underneath its image.</p>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Provide a detailed description of your item."
                rows={4}
              />
            </label>

            <div className="full" style={{ background: 'rgba(255,255,255,0.02)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Properties</h3>
                  <p className="hint mb-0" style={{ fontSize: '0.9rem' }}>Textual traits that show up as rectangles.</p>
                </div>
                <button type="button" className="btn btn-secondary" style={{ padding: '0.5rem 1rem', fontSize: '0.9rem' }} onClick={addAttribute}>
                  + Add trait
                </button>
              </div>
              
              {attributes.length > 0 && (
                <div className="stack-sm">
                  {attributes.map((attr, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: '1rem' }}>
                      <input 
                        placeholder="Type (e.g. Character)" 
                        value={attr.trait_type} 
                        onChange={(e) => updateAttribute(idx, 'trait_type', e.target.value)}
                        style={{ flex: 1 }}
                      />
                      <input 
                        placeholder="Name (e.g. Male)" 
                        value={attr.value} 
                        onChange={(e) => updateAttribute(idx, 'value', e.target.value)}
                        style={{ flex: 1 }}
                      />
                      <button type="button" className="btn btn-icon btn-secondary" onClick={() => removeAttribute(idx)}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <label className="full">
              Recipient Address
              <input
                required
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="Neo N3 Address"
              />
            </label>

            <div className="full form-actions mt-md" style={{ borderTop: '1px solid var(--glass-border)', paddingTop: '1.5rem' }}>
              <button className="btn flex-align-center gap-md btn-lg" disabled={submitting} type="submit" style={{ width: '100%', justifyContent: 'center' }}>
                {submitting ? (
                  "Minting in progress..."
                ) : (
                  <>
                    <Wand2 size={20} /> Create
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        {result ? <p className="success mt-md text-center">{result}</p> : null}
        {error ? <p className="error mt-md text-center">{error}</p> : null}
      </section>
    </div>
  );
}
