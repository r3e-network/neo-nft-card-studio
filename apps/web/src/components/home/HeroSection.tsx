import { Link } from "react-router-dom";

export function HeroSection() {
  return (
    <section className="hero-section" style={{ 
      display: "grid", 
      gridTemplateColumns: "1fr 1fr", 
      gap: "2rem", 
      alignItems: "center",
      padding: "4rem 0",
      minHeight: "70vh"
    }}>
      <div className="stack-md">
        <h1 style={{ fontSize: "4.5rem", fontWeight: 800, lineHeight: 1, letterSpacing: "-0.04em", margin: 0 }}>
          Discover, collect, and sell extraordinary NFTs
        </h1>
        <p style={{ fontSize: "1.5rem", color: "var(--text-muted)", lineHeight: 1.4, maxWidth: "540px", margin: "1.5rem 0" }}>
          A Neo N3 NFT platform to launch collections, mint assets, and trade on-chain with factory and dedicated contract modes.
        </p>
        <div style={{ display: "flex", gap: "1rem" }}>
          <Link className="btn btn-lg" to="/explore" style={{ padding: "1.2rem 2.5rem", borderRadius: "12px", background: "#2081E2", color: "#fff" }}>
            Explore
          </Link>
          <Link className="btn btn-secondary btn-lg" to="/collections/new" style={{ padding: "1.2rem 2.5rem", borderRadius: "12px" }}>
            Create
          </Link>
        </div>
      </div>
      
      <div className="hero-visual" style={{ position: "relative" }}>
        <div className="panel" style={{ padding: 0, borderRadius: "20px", overflow: "hidden", border: "1px solid var(--glass-border)" }}>
          <img 
            src="https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?auto=format&fit=crop&q=80&w=1000" 
            alt="Hero NFT" 
            style={{ width: "100%", height: "450px", objectFit: "cover" }} 
          />
          <div style={{ padding: "1.5rem", display: "flex", alignItems: "center", gap: "1rem" }}>
            <div style={{ width: "45px", height: "45px", borderRadius: "50%", background: "linear-gradient(45deg, var(--neo-green), var(--r3e-cyan))" }}></div>
            <div>
              <div style={{ fontWeight: 700, fontSize: "1.1rem" }}>Ethereal Horizon #42</div>
              <div style={{ color: "#2081E2", fontSize: "0.9rem" }}>R3E Studios</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
