import type { StatsDto } from "../../lib/types";

interface StatsSectionProps {
  stats: StatsDto | null;
}

export function StatsSection({ stats }: StatsSectionProps) {
  return (
    <section className="metric-grid" style={{ background: "rgba(255, 255, 255, 0.03)", padding: "2rem", borderRadius: "20px", border: "1px solid var(--glass-border)" }}>
      <article style={{ textAlign: "center" }}>
        <div style={{ fontSize: "0.9rem", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase" }}>Collections</div>
        <div style={{ fontSize: "2.5rem", fontWeight: 800 }}>{stats?.collectionCount ?? "-"}</div>
      </article>
      <article style={{ textAlign: "center" }}>
        <div style={{ fontSize: "0.9rem", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase" }}>Total Items</div>
        <div style={{ fontSize: "2.5rem", fontWeight: 800 }}>{stats?.tokenCount ?? "-"}</div>
      </article>
      <article style={{ textAlign: "center" }}>
        <div style={{ fontSize: "0.9rem", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase" }}>Transfers</div>
        <div style={{ fontSize: "2.5rem", fontWeight: 800 }}>{stats?.transferCount ?? "-"}</div>
      </article>
    </section>
  );
}
