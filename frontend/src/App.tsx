import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { LeakCategory, Finding, RiskBand, LeakReport, RwState, Token, Rewrite } from "./types";

const API = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

// ── constants ──────────────────────────────────────────────
const CAT_COLOR: Record<LeakCategory, { bg: string; fg: string }> = {
  location:        { bg: "rgba(74,158,255,0.12)",  fg: "#4a9eff" },
  occupation:      { bg: "rgba(163,113,247,0.12)", fg: "#a371f7" },
  age:             { bg: "rgba(63,185,80,0.12)",   fg: "#3fb950" },
  gender:          { bg: "rgba(248,120,217,0.12)", fg: "#f878d9" },
  family:          { bg: "rgba(240,136,62,0.12)",  fg: "#f0883e" },
  health:          { bg: "rgba(248,81,73,0.12)",   fg: "#f85149" },
  interests:       { bg: "rgba(56,189,248,0.12)",  fg: "#38bdf8" },
  education:       { bg: "rgba(139,92,246,0.12)",  fg: "#8b5cf6" },
  relationship:    { bg: "rgba(244,114,182,0.12)", fg: "#f472b6" },
  life_event:      { bg: "rgba(251,191,36,0.12)",  fg: "#fbbf24" },
  writing_style:   { bg: "rgba(148,163,184,0.10)", fg: "#94a3b8" },
  linkable_phrase: { bg: "rgba(248,81,73,0.12)",   fg: "#f85149" },
};

// ── helpers ────────────────────────────────────────────────
function buildTokens(
  text: string,
  findings: Finding[],
  accepted: Record<number, Rewrite>
): Token[] {
  const candidates = findings
    .map((f, i) => {
      const start = text.indexOf(f.evidence_span);
      if (start < 0) return null;
      return { start, end: start + f.evidence_span.length, cat: f.category, idx: i };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a!.start !== b!.start) return a!.start - b!.start;
      return (b!.end - b!.start) - (a!.end - a!.start);
    }) as { start: number; end: number; cat: LeakCategory; idx: number }[];

  const spans: typeof candidates = [];
  let cursor = 0;
  for (const c of candidates) {
    if (c.start < cursor) continue;
    spans.push(c);
    cursor = c.end;
  }

  const tokens: Token[] = [];
  cursor = 0;
  for (const s of spans) {
    if (s.start > cursor) tokens.push({ kind: "plain", text: text.slice(cursor, s.start) });
    const acc = accepted[s.idx];
    if (acc) {
      tokens.push({ kind: "rewritten", original: text.slice(s.start, s.end), replacement: acc.suggestion, cat: s.cat });
    } else {
      tokens.push({ kind: "highlight", text: text.slice(s.start, s.end), cat: s.cat, idx: s.idx });
    }
    cursor = s.end;
  }
  if (cursor < text.length) tokens.push({ kind: "plain", text: text.slice(cursor) });
  return tokens;
}

// ── sub-components ─────────────────────────────────────────
function VLine() {
  return <div style={{ width: 1, flexShrink: 0, background: "var(--border)" }} />;
}

function Titlebar({ status, loading, band }: {
  status: string; loading: boolean; band: RiskBand | null;
}) {
  const dotColor = loading
    ? "var(--band-moderate)"
    : band ? `var(--band-${band})` : "var(--band-low)";
  return (
    <div className="tb">
      <div className="tb-cell tb-brand">
        <span className="tb-app">trace</span>
      </div>
      <div className="tb-cell tb-tab tb-tab-active"><span>analyzer</span></div>
      <div className="tb-spacer" />
      <div className="tb-cell tb-status">
        <div className="dot" style={{ background: dotColor }} />
        <span className="tb-status-text">{status}</span>
      </div>
    </div>
  );
}

function PaneHeader({ title, badges = [], right }: {
  title: string;
  badges?: { text: string; color?: string }[];
  right?: React.ReactNode;
}) {
  return (
    <div className="ph">
      <span className="ph-title">{title}</span>
      {badges.map((b, i) => (
        <span key={i} className="ph-badge" style={b.color ? { color: b.color, borderColor: b.color } : undefined}>
          {b.text}
        </span>
      ))}
      <div className="ph-right">{right}</div>
    </div>
  );
}

function ConfBars({ value }: { value: string }) {
  const n = value === "high" ? 3 : value === "medium" ? 2 : 1;
  return (
    <span className="cb">
      {[0, 1, 2].map((i) => (
        <span key={i} className={`cb-bar ${i < n ? "cb-bar-on" : ""}`} />
      ))}
      <span className="cb-label">{value}</span>
    </span>
  );
}

function HighlightedText({ tokens, hoveredIdx, setHoveredIdx }: {
  tokens: Token[];
  hoveredIdx: number | null;
  setHoveredIdx: (i: number | null) => void;
}) {
  return (
    <div className="ht">
      {tokens.map((t, i) => {
        if (t.kind === "plain") return <span key={i}>{t.text}</span>;
        if (t.kind === "highlight") {
          const c = CAT_COLOR[t.cat!];
          const isHover = hoveredIdx === t.idx;
          return (
            <mark
              key={i}
              className="ht-mark"
              style={{
                color: c.fg,
                borderBottom: `1px solid ${c.fg}`,
                background: isHover ? c.bg : "transparent",
              }}
              onMouseEnter={() => setHoveredIdx(t.idx!)}
              onMouseLeave={() => setHoveredIdx(null)}
            >
              {t.text}
            </mark>
          );
        }
        if (t.kind === "rewritten") {
          const c = CAT_COLOR[t.cat!];
          return (
            <span
              key={i}
              className="ht-rewritten"
              style={{ borderBottom: `1px dashed ${c.fg}`, color: "var(--text)" }}
              title="rewritten"
            >
              {t.replacement}
              <span className="ht-rw-dot" style={{ background: "var(--band-low)" }} />
            </span>
          );
        }
        return null;
      })}
    </div>
  );
}

function RewriteBlock({ rewrite, state, onAccept, onDismiss }: {
  rewrite?: Rewrite | null;
  state: RwState;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  if (state === "loading") {
    return (
      <div className="rw rw-loading">
        <div className="rw-line">
          <span className="rw-tag">suggest</span>
          <span className="rw-spinner" />
          <span className="rw-loading-text">computing minimum-edit rewrite…</span>
        </div>
      </div>
    );
  }
  if (!rewrite) return null;
  if (state === "accepted") {
    return (
      <div className="rw rw-accepted">
        <div className="rw-line">
          <span className="rw-tag rw-tag-accepted">applied</span>
          <span className="rw-accepted-text">↳ {rewrite.suggestion}</span>
          <span className="rw-delta">{rewrite.delta} less unique</span>
        </div>
      </div>
    );
  }
  if (state === "dismissed") {
    return (
      <div className="rw rw-dismissed">
        <span className="rw-tag rw-tag-dismissed">dismissed</span>
        <button className="rw-undo" onClick={onAccept}>undo</button>
      </div>
    );
  }
  // ready
  return (
    <div className="rw rw-ready">
      <div className="rw-row rw-row-orig">
        <span className="rw-gutter rw-gutter-minus">−</span>
        <span className="rw-text rw-text-orig">{rewrite.original}</span>
      </div>
      <div className="rw-row rw-row-new">
        <span className="rw-gutter rw-gutter-plus">+</span>
        <span className="rw-text rw-text-new">{rewrite.suggestion}</span>
      </div>
      <div className="rw-actions">
        <span className="rw-delta">est. {rewrite.delta} matching the profile</span>
        <div className="rw-spacer" />
        <button className="rw-btn rw-btn-dismiss" onClick={onDismiss}>dismiss</button>
        <button className="rw-btn rw-btn-accept" onClick={onAccept}>
          accept <span className="rw-kbd">↵</span>
        </button>
      </div>
    </div>
  );
}

function FindingRow({ finding, index, hovered, onHover, rwState, onSuggest, onAccept, onDismiss }: {
  finding: Finding;
  index: number;
  hovered: boolean;
  onHover: (i: number | null) => void;
  rwState: RwState;
  onSuggest: (i: number) => void;
  onAccept: (i: number) => void;
  onDismiss: (i: number) => void;
}) {
  const c = CAT_COLOR[finding.category];
  const distAbbr: Record<string, string> = {
    common: "common",
    somewhat_distinctive: "somewhat dist.",
    highly_distinctive: "highly dist.",
  };

  return (
    <div
      className="fr"
      style={{ padding: "9px 14px", background: hovered ? "rgba(74,158,255,0.025)" : undefined }}
      onMouseEnter={() => onHover(index)}
      onMouseLeave={() => onHover(null)}
    >
      <div className="fr-grid">
        <div className="fr-idx">{String(index + 1).padStart(2, "0")}</div>
        <div className="fr-meta">
          <span className="fr-cat" style={{ background: c.bg, color: c.fg, borderColor: c.fg + "40" }}>
            {finding.category.replace(/_/g, " ")}
          </span>
          <div className="fr-meta-row">
            <span className="fr-meta-key">conf</span>
            <ConfBars value={finding.confidence} />
          </div>
          <div className="fr-meta-row">
            <span className="fr-meta-key">dist</span>
            <span className="fr-meta-val">{distAbbr[finding.distinctiveness] ?? finding.distinctiveness}</span>
          </div>
        </div>
        <div className="fr-body">
          <div className="fr-inference">{finding.inference}</div>
          <div className="fr-evidence" style={{ borderLeftColor: c.fg }}>
            <span className="fr-ev-quote">"</span>
            <span className="fr-ev-text">{finding.evidence_span}</span>
            <span className="fr-ev-quote">"</span>
          </div>
          <div className="fr-reasoning">{finding.reasoning}</div>
        </div>
        <div className="fr-actions">
          {rwState === "idle" ? (
            <button className="fr-suggest" onClick={() => onSuggest(index)}>
              suggest rewrite
              <span className="fr-suggest-arrow">→</span>
            </button>
          ) : null}
        </div>
      </div>
      {rwState !== "idle" && (
        <div className="fr-rewrite-wrap">
          <RewriteBlock
            rewrite={finding.rewrite}
            state={rwState}
            onAccept={() => onAccept(index)}
            onDismiss={() => onDismiss(index)}
          />
        </div>
      )}
    </div>
  );
}

function ScaleBar({ band }: { band: RiskBand }) {
  const order: RiskBand[] = ["low", "moderate", "high", "severe"];
  const colors: Record<RiskBand, string> = {
    low: "#3fb950", moderate: "#d29922", high: "#f0883e", severe: "#f85149",
  };
  return (
    <div className="sb">
      {order.map((b) => (
        <div
          key={b}
          className={`sb-cell ${band === b ? "sb-cell-on" : ""}`}
          style={{ "--sb-c": colors[b] } as React.CSSProperties}
        >
          <span>{b}</span>
        </div>
      ))}
    </div>
  );
}

function RiskBanner({ risk }: { risk: LeakReport["risk"] }) {
  const color = `var(--band-${risk.band})`;
  return (
    <div className="rb" style={{ borderTopColor: color }}>
      <div className="rb-row1">
        <span className="rb-band" style={{ color, borderColor: color + "55", background: color + "14" }}>
          {risk.band}
        </span>
        <span className="rb-pop-label">est. matching pop.</span>
        <span className="rb-pop" style={{ color }}>{risk.matching_population.toLocaleString()}</span>
        <div className="rb-spacer" />
        <span className="rb-frac" title="joint identifiability fraction">
          P ≈ {risk.joint_fraction.toExponential(1)}
        </span>
      </div>
      <div className="rb-headline">{risk.headline}</div>
      <div className="rb-explain">{risk.explanation}</div>
      <div className="rb-scale"><ScaleBar band={risk.band} /></div>
    </div>
  );
}

function EmptyState() {
  const lines = [
    { t: "comment", v: "// trace · identity-signal analyzer" },
    { t: "blank" },
    { t: "comment", v: "// pipeline" },
    { t: "key", v: "  extract  → 12 leak categories" },
    { t: "key", v: "  score    → joint identifiability heuristic" },
    { t: "key", v: "  highlight → exact spans, color-coded" },
    { t: "key", v: "  rewrite  → minimum-edit suggestions" },
    { t: "blank" },
    { t: "comment", v: "// usage" },
    { t: "key", v: "  paste post (left)" },
    { t: "key", v: "  ⌃↵  to run" },
    { t: "blank" },
    { t: "comment", v: "// awaiting input." },
  ];
  return (
    <div className="es">
      {lines.map((l, i) => (
        <div key={i} className={`es-${l.t}`}>{l.v ?? "\u00a0"}</div>
      ))}
    </div>
  );
}

function FindingsHeader({ count, rewritableCount, acceptedCount, pendingCount,
  onRewriteAll, onAcceptAll, onResetAll, rewriteAllRunning }: {
  count: number; rewritableCount: number; acceptedCount: number; pendingCount: number;
  onRewriteAll: () => void; onAcceptAll: () => void; onResetAll: () => void; rewriteAllRunning: boolean;
}) {
  return (
    <div className="fh">
      <span className="fh-title">findings</span>
      <span className="fh-count">[{count}]</span>
      {pendingCount > 0 && <span className="fh-pending">{pendingCount} pending</span>}
      {acceptedCount > 0 && <span className="fh-accepted">{acceptedCount} applied</span>}
      <div className="fh-spacer" />
      {acceptedCount > 0 && <button className="fh-action fh-reset" onClick={onResetAll}>reset</button>}
      {pendingCount > 0 && (
        <button className="fh-action fh-accept-all" onClick={onAcceptAll}>
          accept all ({pendingCount})
        </button>
      )}
      <button
        className="fh-action fh-rewrite-all"
        onClick={onRewriteAll}
        disabled={rewriteAllRunning || rewritableCount === 0 || rewritableCount === acceptedCount}
      >
        {rewriteAllRunning && <span className="rw-spinner" />}
        {rewriteAllRunning ? "rewriting…" : `rewrite all (${rewritableCount})`}
        <span className="fh-kbd">⌘R</span>
      </button>
    </div>
  );
}

function Statusbar({ analysed, charCount, signalCount, acceptedCount, latency }: {
  analysed: boolean; charCount: number; signalCount: number; acceptedCount: number; latency: number | null;
}) {
  return (
    <div className="sbar">
      <span className="sbar-app">trace</span>
      {analysed && (
        <>
          <span className="sbar-sep">·</span>
          <span className="sbar-val">{charCount.toLocaleString()} chars</span>
          <span className="sbar-sep">·</span>
          <span className="sbar-val">{signalCount} signals</span>
          {acceptedCount > 0 && (
            <>
              <span className="sbar-sep">·</span>
              <span className="sbar-val sbar-val-good">{acceptedCount} rewrites applied</span>
            </>
          )}
        </>
      )}
      <div className="sbar-spacer" />
      {latency && (
        <span className="sbar-val">{latency}ms</span>
      )}
    </div>
  );
}

// ── main app ───────────────────────────────────────────────
type Phase = "input" | "loading" | "results";

export default function App() {
  const [phase, setPhase]         = useState<Phase>("input");
  const [text, setText]           = useState("");
  const [report, setReport]       = useState<LeakReport | null>(null);
  const [rwState, setRwState]     = useState<Record<number, RwState>>({});
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [rewriteAllRunning, setRewriteAllRunning] = useState(false);
  const [latency, setLatency]     = useState<number | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const findings = report?.findings ?? [];

  const accepted = useMemo(() => {
    const a: Record<number, Rewrite> = {};
    Object.entries(rwState).forEach(([k, v]) => {
      if (v === "accepted") {
        const f = findings[+k];
        if (f?.rewrite) a[+k] = f.rewrite;
      }
    });
    return a;
  }, [rwState, findings]);

  const tokens = useMemo(
    () => (report ? buildTokens(text, findings, accepted) : []),
    [text, findings, accepted, report]
  );

  const acceptedCount    = Object.values(rwState).filter((v) => v === "accepted").length;
  const pendingCount     = Object.values(rwState).filter((v) => v === "ready").length;
  const rewritableCount  = findings.length;

  const runAnalysis = useCallback(async () => {
    if (!text.trim() || phase === "loading") return;
    setPhase("loading");
    setReport(null);
    setRwState({});
    setError(null);
    const t0 = Date.now();
    try {
      const res = await fetch(`${API}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { detail?: string }).detail ?? `HTTP ${res.status}`);
      }
      const data: LeakReport = await res.json();
      setReport(data);
      setLatency(Date.now() - t0);
      setPhase("results");
    } catch (e) {
      setError((e as Error).message);
      setPhase("input");
    }
  }, [text, phase]);

  const editAgain = () => { setPhase("input"); setReport(null); setRwState({}); };

  const suggestOne = useCallback(async (idx: number) => {
  const finding = findings[idx];
  if (!finding) return;
  setRwState((s) => ({ ...s, [idx]: "loading" }));
  try {
    const res = await fetch(`${API}/rewrite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.trim(), finding }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { detail?: string }).detail ?? `HTTP ${res.status}`);
    }
    const rewrite: Rewrite = await res.json();
    setReport((r) => {
      if (!r) return r;
      const updated = r.findings.map((f, i) =>
        i === idx ? { ...f, rewrite } : f
      );
      return { ...r, findings: updated };
    });
    setRwState((s) => ({ ...s, [idx]: "ready" }));
  } catch (e) {
    // quietly fall back to idle so user can retry
    setRwState((s) => ({ ...s, [idx]: "idle" }));
    console.error("rewrite failed:", (e as Error).message);
  }
}, [findings, text]);

  const acceptOne  = (idx: number) => setRwState((s) => ({ ...s, [idx]: "accepted" }));
  const dismissOne = (idx: number) => setRwState((s) => ({ ...s, [idx]: "dismissed" }));

  const rewriteAll = useCallback(async () => {
  if (rewriteAllRunning) return;
  setRewriteAllRunning(true);
  const idxs = findings
    .map((_f, i) => (rwState[i] !== "accepted" ? i : null))
    .filter((i): i is number => i !== null);
  for (const idx of idxs) {
    const finding = findings[idx];
    setRwState((s) => ({ ...s, [idx]: "loading" }));
    try {
      const res = await fetch(`${API}/rewrite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim(), finding }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rewrite: Rewrite = await res.json();
      setReport((r) => {
        if (!r) return r;
        const updated = r.findings.map((f, i) =>
          i === idx ? { ...f, rewrite } : f
        );
        return { ...r, findings: updated };
      });
      setRwState((s) => ({ ...s, [idx]: "accepted" }));
    } catch {
      setRwState((s) => ({ ...s, [idx]: "idle" }));
    }
  }
  setRewriteAllRunning(false);
}, [findings, rwState, text, rewriteAllRunning]);

  const acceptAllPending = () => {
    setRwState((s) => {
      const ns = { ...s };
      Object.entries(s).forEach(([k, v]) => { if (v === "ready") ns[+k] = "accepted"; });
      return ns;
    });
  };

  const resetRewrites = () => setRwState({});

  const copyRewritten = useCallback(() => {
  const rewritten = tokens.map((t) => {
    if (t.kind === "plain") return t.text ?? "";
    if (t.kind === "highlight") return t.text ?? "";
    if (t.kind === "rewritten") return t.replacement ?? "";
    return "";
  }).join("");
  navigator.clipboard.writeText(rewritten);
}, [tokens]);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phase === "results" && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "r" && !e.shiftKey) {
        e.preventDefault();
        rewriteAll();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, rewriteAll]);

  const charCount = text.length;
  const status =
    phase === "loading" ? "running"
    : phase === "results" && report ? `${findings.length} signals · ${report.risk.band}`
    : "idle";

  return (
    <div className="app">
      <Titlebar
        status={status}
        loading={phase === "loading"}
        band={phase === "results" && report ? report.risk.band : null}
      />

      <div className="ws">
        {/* ── left pane ── */}
        <div className="pane">
          <PaneHeader
            title="input.txt"
            badges={
              phase === "results" && acceptedCount > 0
                ? [{ text: `${acceptedCount} edits`, color: "var(--band-low)" }]
                : []
            }
            right={
              phase === "results" ? (
                <div style={{ display: "flex", gap: 8 }}>
                  {acceptedCount > 0 && (
                      <button className="ph-link" onClick={copyRewritten}>copy rewritten ↗</button>
                    )}
                    <button className="ph-link" onClick={editAgain}>← edit</button>
                </div>
              ) : charCount > 0 ? (
                <span className="ph-meta">{charCount.toLocaleString()} chars</span>
              ) : null
            }
          />
          <div className="pane-body">
            {phase === "results" && report ? (
              <div className="ht-wrap">
                <HighlightedText tokens={tokens} hoveredIdx={hoveredIdx} setHoveredIdx={setHoveredIdx} />
              </div>
            ) : (
              <textarea
                ref={taRef}
                className="ta"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runAnalysis(); } }}
                placeholder={"// paste a draft post or comment here\n// ⌃↵ to run analysis\n//\n// the analyzer returns:\n//   · category-tagged spans\n//   · joint-identifiability score\n//   · minimum-edit rewrite suggestions"}
                spellCheck={false}
                maxLength={10000}
              />
            )}
          </div>
          <div className="tbar">
            <span className={`tbar-val ${charCount > 9000 ? "warn" : ""}`}>{charCount}/10000</span>
            {phase === "results" && (
              <>
                <span className="tbar-sep">·</span>
                <span className="tbar-key">spans</span>
                <span className="tbar-val">{findings.length}</span>
              </>
            )}
            <div className="tbar-spacer" />
            {phase === "results" ? (
              <button className="run-btn" onClick={editAgain}>
                <span className="run-btn-icon">←</span>
                edit input
              </button>
            ) : (
              <button
                className="run-btn run-btn-primary"
                disabled={phase === "loading" || !text.trim()}
                onClick={runAnalysis}
              >
                {phase === "loading" && <span className="rw-spinner" />}
                {phase === "loading" ? "running…" : "run analysis"}
                {phase !== "loading" && <span className="run-kbd">⌃↵</span>}
              </button>
            )}
          </div>
        </div>

        <VLine />

        {/* ── right pane ── */}
        <div className="pane">
          <PaneHeader
            title="report.json"
            badges={
              phase === "results" && report
                ? [
                    { text: report.risk.band, color: `var(--band-${report.risk.band})` },
                    { text: `~${report.risk.matching_population.toLocaleString()} match`, color: "var(--text3)" },
                  ]
                : []
            }
            right={
              phase === "results" && report ? (
                <span className="ph-meta">{findings.length} signal{findings.length !== 1 ? "s" : ""}</span>
              ) : null
            }
          />
          <div className="pane-body pane-body-scroll">
            {phase === "input" && !error && <EmptyState />}

            {error && (
              <div style={{ margin: 16, padding: "10px 12px", background: "rgba(248,81,73,0.08)", borderLeft: "2px solid var(--band-severe)", color: "var(--band-severe)", fontSize: 11, lineHeight: 1.6 }}>
                error: {error}
              </div>
            )}

            {phase === "loading" && (
              <div className="loading-state">
                <div className="ls-line"><span className="rw-spinner" /> analyzing…</div>
                <div className="ls-line ls-dim">→ extracting leak categories</div>
                <div className="ls-line ls-dim">→ scoring joint identifiability</div>
                <div className="ls-line ls-dim">→ aligning evidence spans</div>
              </div>
            )}

            {phase === "results" && report && (
              <>
                <RiskBanner risk={report.risk} />
                <div className="summary">
                  <span className="summary-prefix">summary &gt;</span>
                  <span className="summary-text">{report.summary}</span>
                </div>
                <FindingsHeader
                  count={findings.length}
                  rewritableCount={rewritableCount}
                  acceptedCount={acceptedCount}
                  pendingCount={pendingCount}
                  onRewriteAll={rewriteAll}
                  onAcceptAll={acceptAllPending}
                  onResetAll={resetRewrites}
                  rewriteAllRunning={rewriteAllRunning}
                />
                <div className="findings">
                  {findings.map((f, i) => (
                    <FindingRow
                      key={i}
                      finding={f}
                      index={i}
                      hovered={hoveredIdx === i}
                      onHover={setHoveredIdx}
                      rwState={rwState[i] ?? "idle"}
                      onSuggest={suggestOne}
                      onAccept={acceptOne}
                      onDismiss={dismissOne}
                    />
                  ))}
                </div>
                <div className="eor">
                  <span className="eor-line">// end of report</span>
                  <span className="eor-meta">{findings.length} findings · {acceptedCount} rewrites applied</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <Statusbar
        analysed={phase === "results"}
        charCount={charCount}
        signalCount={findings.length}
        acceptedCount={acceptedCount}
        latency={latency}
      />
    </div>
  );
}