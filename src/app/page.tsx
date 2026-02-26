"use client";

import { useState, useMemo, useEffect } from "react";

interface ScriptSettings {
  targetSeconds: number;
  style: "hype" | "analytical" | "conversational";
  includeGraphics: boolean;
  includeStats: boolean;
}

interface UsageInfo {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

interface ScriptSections {
  hook: string;
  body: string;
  cta: string;
}

interface GeneratedResult {
  sections: ScriptSections;
  fullScript: string;
  wordCount: number;
  estimatedSeconds: number;
  hookSeconds: number;
  bodySeconds: number;
  ctaSeconds: number;
  backgroundFootage: string[];
  graphicsNeeded: string[];
  productionNotes: string[];
  hookAlternatives: string[];
  videoTitle: string;
  channel: string;
  platform: string;
  usage: UsageInfo[];
  totalCost: number;
}

const DURATION_OPTIONS = [
  { value: 30, label: "30s" },
  { value: 45, label: "45s" },
  { value: 60, label: "60s" },
  { value: 90, label: "90s" },
];

const STYLE_OPTIONS: {
  value: ScriptSettings["style"];
  label: string;
  desc: string;
}[] = [
  { value: "hype", label: "Hype", desc: "High energy, punchy" },
  { value: "analytical", label: "Analytical", desc: "Data-driven, sharp" },
  { value: "conversational", label: "Casual", desc: "Friendly, relatable" },
];

function detectPlatform(url: string): "youtube" | "instagram" | "unknown" {
  if (/youtube\.com|youtu\.be/i.test(url)) return "youtube";
  if (/instagram\.com/i.test(url)) return "instagram";
  return "unknown";
}

const STORAGE_KEY = "novig-scripter-usage";

interface SessionUsage {
  totalCost: number;
  totalTokens: number;
  generations: number;
  since: string;
}

function loadUsage(): SessionUsage {
  if (typeof window === "undefined")
    return {
      totalCost: 0,
      totalTokens: 0,
      generations: 0,
      since: new Date().toISOString(),
    };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {
    totalCost: 0,
    totalTokens: 0,
    generations: 0,
    since: new Date().toISOString(),
  };
}

function saveUsage(u: SessionUsage) {
  if (typeof window !== "undefined")
    localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
}

function wc(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [manualTranscript, setManualTranscript] = useState("");
  const [settings, setSettings] = useState<ScriptSettings>({
    targetSeconds: 60,
    style: "hype",
    includeGraphics: true,
    includeStats: true,
  });
  const [result, setResult] = useState<GeneratedResult | null>(null);
  const [editedSections, setEditedSections] = useState<ScriptSections | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [transcriptFallback, setTranscriptFallback] = useState(false);
  const [usage, setUsage] = useState<SessionUsage>({
    totalCost: 0,
    totalTokens: 0,
    generations: 0,
    since: new Date().toISOString(),
  });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setUsage(loadUsage());
    setMounted(true);
  }, []);

  // When result changes, initialize editable sections
  useEffect(() => {
    if (result?.sections) {
      setEditedSections({ ...result.sections });
    }
  }, [result]);

  const platform = useMemo(() => detectPlatform(url), [url]);
  const needsManualTranscript = platform === "instagram" || transcriptFallback;
  const canGenerate =
    url.trim() &&
    (!needsManualTranscript || manualTranscript.trim()) &&
    !loading;

  // Computed stats from edited sections
  const editedFullScript = editedSections
    ? `${editedSections.hook}\n\n${editedSections.body}\n\n${editedSections.cta}`
    : "";
  const editedWordCount = wc(editedFullScript);
  const editedSeconds = Math.round(editedWordCount / 2.8);

  async function handleGenerate() {
    if (!canGenerate) return;
    setLoading(true);
    setError("");
    setResult(null);
    setEditedSections(null);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          manualTranscript: manualTranscript.trim() || undefined,
          settings,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        if (
          data.error?.includes("Transcript is disabled") ||
          data.error?.includes("No transcript available") ||
          data.error?.includes("require a manual transcript") ||
          data.code === "TRANSCRIPT_UNAVAILABLE"
        ) {
          setTranscriptFallback(true);
          setError(
            "Captions unavailable. Paste what they say in the transcript box below, then hit Generate again."
          );
          setLoading(false);
          return;
        }
        throw new Error(data.error || "Failed to generate script");
      }
      setResult(data);

      const updated: SessionUsage = {
        totalCost: usage.totalCost + (data.totalCost || 0),
        totalTokens:
          usage.totalTokens +
          (data.usage?.reduce(
            (sum: number, u: UsageInfo) => sum + u.totalTokens,
            0
          ) || 0),
        generations: usage.generations + 1,
        since: usage.since,
      };
      setUsage(updated);
      saveUsage(updated);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  function resetUsage() {
    const fresh: SessionUsage = {
      totalCost: 0,
      totalTokens: 0,
      generations: 0,
      since: new Date().toISOString(),
    };
    setUsage(fresh);
    saveUsage(fresh);
  }

  function swapHook(alt: string) {
    if (editedSections) {
      setEditedSections({ ...editedSections, hook: alt });
    }
  }

  function copyFullScript() {
    navigator.clipboard.writeText(editedFullScript);
  }

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Header */}
      <div className="border-b border-white/10 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center font-bold text-sm">
              N
            </div>
            <h1 className="text-lg font-semibold tracking-tight">
              Novig Scripter
            </h1>
          </div>
          {mounted && (
            <div className="flex items-center gap-3 text-xs text-white/40 bg-white/[0.03] border border-white/5 rounded-lg px-3 py-1.5">
              <span>
                <span className="text-white/60 font-medium">
                  ${usage.totalCost.toFixed(4)}
                </span>{" "}
                spent
              </span>
              <span className="text-white/10">|</span>
              <span>{usage.generations} scripts</span>
              <button
                onClick={resetUsage}
                className="text-white/20 hover:text-white/40 transition-colors cursor-pointer ml-1"
                title="Reset"
              >
                reset
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {/* Input */}
        <section className="space-y-4">
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <input
                type="text"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setTranscriptFallback(false);
                }}
                onKeyDown={(e) =>
                  e.key === "Enter" && canGenerate && handleGenerate()
                }
                placeholder="Paste YouTube or Instagram video URL..."
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm placeholder:text-white/30 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/25 transition-colors pr-24"
              />
              {url.trim() && (
                <span
                  className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs px-2 py-0.5 rounded-full ${
                    platform === "youtube"
                      ? "bg-red-500/15 text-red-400"
                      : platform === "instagram"
                        ? "bg-purple-500/15 text-purple-400"
                        : "bg-white/5 text-white/30"
                  }`}
                >
                  {platform === "youtube"
                    ? "YouTube"
                    : platform === "instagram"
                      ? "Instagram"
                      : "Unknown"}
                </span>
              )}
            </div>
            <button
              onClick={handleGenerate}
              disabled={!canGenerate}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-white/10 disabled:text-white/30 px-6 py-3 rounded-lg text-sm font-medium transition-colors cursor-pointer shrink-0"
            >
              {loading ? "Generating..." : "Generate Script"}
            </button>
          </div>

          {(needsManualTranscript || manualTranscript) && (
            <div className="space-y-1.5">
              <label className="text-xs text-white/40">
                {transcriptFallback && platform === "youtube" ? (
                  <span>
                    <span className="text-amber-400">No captions found</span> —
                    paste what they say
                  </span>
                ) : platform === "instagram" ? (
                  <span>
                    <span className="text-purple-400">Instagram</span> — paste
                    transcript below
                  </span>
                ) : (
                  "Manual transcript (overrides auto-extract)"
                )}
              </label>
              <textarea
                value={manualTranscript}
                onChange={(e) => setManualTranscript(e.target.value)}
                placeholder="Paste transcript here..."
                rows={4}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm placeholder:text-white/30 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/25 transition-colors resize-y"
              />
            </div>
          )}

          {platform === "youtube" &&
            !manualTranscript &&
            !transcriptFallback && (
              <button
                onClick={() => setManualTranscript(" ")}
                className="text-xs text-white/20 hover:text-white/40 transition-colors cursor-pointer"
              >
                + Override with manual transcript
              </button>
            )}

          {/* Settings */}
          <div className="flex flex-wrap items-center gap-6 p-4 bg-white/[0.03] border border-white/5 rounded-lg">
            <div className="space-y-1.5">
              <label className="text-xs text-white/40 uppercase tracking-wider">
                Duration
              </label>
              <div className="flex gap-1">
                {DURATION_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() =>
                      setSettings((s) => ({ ...s, targetSeconds: opt.value }))
                    }
                    className={`px-3 py-1.5 text-xs rounded-md transition-colors cursor-pointer ${
                      settings.targetSeconds === opt.value
                        ? "bg-emerald-600 text-white"
                        : "bg-white/5 text-white/50 hover:text-white/80"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-white/40 uppercase tracking-wider">
                Style
              </label>
              <div className="flex gap-1">
                {STYLE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() =>
                      setSettings((s) => ({ ...s, style: opt.value }))
                    }
                    title={opt.desc}
                    className={`px-3 py-1.5 text-xs rounded-md transition-colors cursor-pointer ${
                      settings.style === opt.value
                        ? "bg-emerald-600 text-white"
                        : "bg-white/5 text-white/50 hover:text-white/80"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-4 ml-auto">
              <Toggle
                label="Graphics"
                checked={settings.includeGraphics}
                onChange={(v) =>
                  setSettings((s) => ({ ...s, includeGraphics: v }))
                }
              />
              <Toggle
                label="Stats"
                checked={settings.includeStats}
                onChange={(v) =>
                  setSettings((s) => ({ ...s, includeStats: v }))
                }
              />
            </div>
          </div>
        </section>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg text-sm">
            {error}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="space-y-3 text-center">
              <div className="w-8 h-8 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin mx-auto" />
              <p className="text-sm text-white/40">
                {needsManualTranscript
                  ? "Generating script..."
                  : "Extracting transcript & generating script..."}
              </p>
            </div>
          </div>
        )}

        {/* Results */}
        {result && editedSections && !loading && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              {/* Meta */}
              <div className="flex items-center gap-3 text-sm">
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    result.platform === "youtube"
                      ? "bg-red-500/15 text-red-400"
                      : result.platform === "instagram"
                        ? "bg-purple-500/15 text-purple-400"
                        : "bg-white/5 text-white/30"
                  }`}
                >
                  {result.platform === "youtube"
                    ? "YT"
                    : result.platform === "instagram"
                      ? "IG"
                      : "Manual"}
                </span>
                <span className="text-white/40">{result.channel}</span>
                <span className="text-white/10">|</span>
                <span className="text-white/60 truncate">
                  {result.videoTitle}
                </span>
              </div>

              {/* Stats */}
              <div className="flex gap-3">
                <Stat label="Words" value={editedWordCount.toString()} />
                <Stat
                  label="Est. Duration"
                  value={`${editedSeconds}s`}
                  highlight={
                    Math.abs(editedSeconds - settings.targetSeconds) <= 5
                  }
                  warn={Math.abs(editedSeconds - settings.targetSeconds) > 10}
                />
                <Stat label="Target" value={`${settings.targetSeconds}s`} />
                <Stat
                  label="Cost"
                  value={`$${result.totalCost.toFixed(4)}`}
                />
              </div>

              {/* ── HOOK Section ── */}
              <ScriptSection
                label="Hook"
                timing={`~${Math.round(wc(editedSections.hook) / 2.8)}s`}
                color="text-amber-400"
                borderColor="border-amber-500/30"
                bgColor="bg-amber-500/5"
                value={editedSections.hook}
                onChange={(v) =>
                  setEditedSections({ ...editedSections, hook: v })
                }
              />

              {/* Hook Alternatives */}
              {result.hookAlternatives.length > 0 && (
                <div className="space-y-2">
                  <span className="text-xs text-white/30 uppercase tracking-wider">
                    Alternative Hooks — click to swap
                  </span>
                  <div className="space-y-1.5">
                    {result.hookAlternatives.map((alt, i) => (
                      <button
                        key={i}
                        onClick={() => swapHook(alt)}
                        className="w-full text-left bg-white/[0.02] hover:bg-white/[0.05] border border-white/5 hover:border-amber-500/20 rounded-lg px-4 py-2.5 text-sm text-white/50 hover:text-white/70 transition-all cursor-pointer"
                      >
                        {alt}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* ── BODY Section ── */}
              <ScriptSection
                label="Body"
                timing={`~${Math.round(wc(editedSections.body) / 2.8)}s`}
                color="text-emerald-400"
                borderColor="border-emerald-500/30"
                bgColor="bg-emerald-500/5"
                value={editedSections.body}
                onChange={(v) =>
                  setEditedSections({ ...editedSections, body: v })
                }
              />

              {/* ── CTA Section ── */}
              <ScriptSection
                label="CTA"
                timing={`~${Math.round(wc(editedSections.cta) / 2.8)}s`}
                color="text-blue-400"
                borderColor="border-blue-500/30"
                bgColor="bg-blue-500/5"
                value={editedSections.cta}
                onChange={(v) =>
                  setEditedSections({ ...editedSections, cta: v })
                }
              />

              {/* Copy full script */}
              <button
                onClick={copyFullScript}
                className="w-full bg-emerald-600 hover:bg-emerald-500 py-3 rounded-lg text-sm font-medium transition-colors cursor-pointer"
              >
                Copy Full Script
              </button>

              {/* Token breakdown */}
              {result.usage && result.usage.length > 0 && (
                <details className="text-xs text-white/30">
                  <summary className="cursor-pointer hover:text-white/50 transition-colors">
                    Token usage breakdown
                  </summary>
                  <div className="mt-2 bg-white/[0.02] border border-white/5 rounded-lg p-3 space-y-1">
                    {result.usage.map((u, i) => (
                      <div key={i} className="flex justify-between">
                        <span className="font-mono">{u.model}</span>
                        <span>
                          {u.promptTokens.toLocaleString()} in /{" "}
                          {u.completionTokens.toLocaleString()} out ={" "}
                          <span className="text-white/50">
                            ${u.estimatedCost.toFixed(4)}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>

            {/* Sidebar */}
            <div className="space-y-4">
              {/* Timing breakdown */}
              <Panel title="Section Timing">
                <div className="space-y-3">
                  <TimingRow
                    label="Hook"
                    seconds={Math.round(wc(editedSections.hook) / 2.8)}
                    color="bg-amber-500"
                    total={editedSeconds}
                  />
                  <TimingRow
                    label="Body"
                    seconds={Math.round(wc(editedSections.body) / 2.8)}
                    color="bg-emerald-500"
                    total={editedSeconds}
                  />
                  <TimingRow
                    label="CTA"
                    seconds={Math.round(wc(editedSections.cta) / 2.8)}
                    color="bg-blue-500"
                    total={editedSeconds}
                  />
                  <div className="border-t border-white/5 pt-2 flex justify-between text-sm">
                    <span className="text-white/40">Total</span>
                    <span
                      className={
                        Math.abs(editedSeconds - settings.targetSeconds) <= 5
                          ? "text-emerald-400"
                          : "text-amber-400"
                      }
                    >
                      {editedSeconds}s / {settings.targetSeconds}s
                    </span>
                  </div>
                </div>
              </Panel>

              <Panel title="Background Footage">
                <ul className="space-y-2">
                  {result.backgroundFootage.map((f, i) => (
                    <li key={i} className="text-sm text-white/60 flex gap-2">
                      <span className="text-emerald-500/60 shrink-0">
                        {i + 1}.
                      </span>
                      {f}
                    </li>
                  ))}
                </ul>
              </Panel>

              {result.graphicsNeeded.length > 0 && (
                <Panel title="Graphics Needed">
                  <ul className="space-y-2">
                    {result.graphicsNeeded.map((g, i) => (
                      <li
                        key={i}
                        className="text-sm text-white/60 flex gap-2"
                      >
                        <span className="text-amber-500/60 shrink-0">*</span>
                        {g}
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}

              <Panel title="Production Notes">
                <ul className="space-y-2">
                  {result.productionNotes.map((n, i) => (
                    <li key={i} className="text-sm text-white/60 flex gap-2">
                      <span className="text-blue-500/60 shrink-0">*</span>
                      {n}
                    </li>
                  ))}
                </ul>
              </Panel>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

// ── Components ──

function ScriptSection({
  label,
  timing,
  color,
  borderColor,
  bgColor,
  value,
  onChange,
}: {
  label: string;
  timing: string;
  color: string;
  borderColor: string;
  bgColor: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className={`${bgColor} border ${borderColor} rounded-lg p-4`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold uppercase tracking-wider ${color}`}>
            {label}
          </span>
          <span className="text-xs text-white/30">{timing}</span>
        </div>
        <span className="text-xs text-white/20">{wc(value)} words</span>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={Math.max(2, value.split("\n").length + 1)}
        className="w-full bg-transparent text-sm leading-relaxed font-[family-name:var(--font-geist-mono)] text-white/80 resize-y focus:outline-none placeholder:text-white/20"
      />
    </div>
  );
}

function TimingRow({
  label,
  seconds,
  color,
  total,
}: {
  label: string;
  seconds: number;
  color: string;
  total: number;
}) {
  const pct = total > 0 ? (seconds / total) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-white/40">{label}</span>
        <span className="text-white/50">{seconds}s</span>
      </div>
      <div className="w-full bg-white/5 rounded-full h-1.5">
        <div
          className={`h-1.5 rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 cursor-pointer"
    >
      <div
        className={`w-8 h-4.5 rounded-full transition-colors relative ${
          checked ? "bg-emerald-600" : "bg-white/10"
        }`}
      >
        <div
          className={`absolute top-0.5 w-3.5 h-3.5 bg-white rounded-full transition-transform ${
            checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </div>
      <span className="text-xs text-white/50">{label}</span>
    </button>
  );
}

function Stat({
  label,
  value,
  highlight,
  warn,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="bg-white/[0.03] border border-white/5 rounded-lg px-3 py-2 flex-1 min-w-0">
      <div className="text-xs text-white/30 mb-0.5">{label}</div>
      <div
        className={`text-base font-semibold truncate ${
          warn
            ? "text-amber-400"
            : highlight
              ? "text-emerald-400"
              : "text-white/80"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white/[0.03] border border-white/5 rounded-lg p-4">
      <h3 className="text-xs font-medium text-white/40 uppercase tracking-wider mb-3">
        {title}
      </h3>
      {children}
    </div>
  );
}
