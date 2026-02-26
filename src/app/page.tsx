"use client";

import { useState, useMemo, useEffect, useCallback } from "react";

// ── Types ──

interface ScriptSettings {
  targetSeconds: number;
  style: "hype" | "analytical" | "conversational";
  includeGraphics: boolean;
  includeStats: boolean;
  customHook?: string;
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

interface TimelineClip {
  id: string;
  section: "hook" | "body" | "cta";
  label: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  startFrame: number;
  endFrame: number;
  durationFrames: number;
  text: string;
  wordCount: number;
  footage: string;
  overlays: string[];
}

interface EditingTimeline {
  fps: number;
  totalDurationSec: number;
  totalFrames: number;
  clips: TimelineClip[];
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
  timeline: EditingTimeline;
  videoTitle: string;
  channel: string;
  platform: string;
  usage: UsageInfo[];
  totalCost: number;
}

interface PicksScriptOutput {
  hook: string;
  hookId: string;
  script: string;
  wordCount: number;
  estimatedDuration: number;
  players: string[];
  teams: string[];
  picks: { team: string; line: string; type: "spread" | "total" | "moneyline" }[];
  title: string;
  date: string;
}

interface HookData {
  id: string;
  text: string;
  tone: "hype" | "controversial" | "confident" | "casual" | "authoritative";
  format: "statement" | "question" | "declaration";
  tags: string[];
}

// ── Constants ──

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

const SPORT_OPTIONS = ["NBA", "NFL", "MLB", "NHL"];
const PICK_COUNT_OPTIONS = [1, 2, 3, 4];
const TONE_OPTIONS: HookData["tone"][] = ["hype", "controversial", "confident", "casual", "authoritative"];

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ── Helpers ──

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
    return { totalCost: 0, totalTokens: 0, generations: 0, since: new Date().toISOString() };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { totalCost: 0, totalTokens: 0, generations: 0, since: new Date().toISOString() };
}

function saveUsage(u: SessionUsage) {
  if (typeof window !== "undefined")
    localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
}

function wc(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function getTodayDayName(): string {
  return DAYS[new Date().getDay()];
}

function getTodayDate(): string {
  return new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

// ── Client-side YouTube transcript extraction ──

function extractVideoId(url: string): string | null {
  const m = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/
  );
  return m ? m[1] : null;
}

async function clientExtractTranscript(videoId: string): Promise<string | null> {
  try {
    const playerRes = await fetch(
      "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId,
          context: {
            client: { clientName: "ANDROID", clientVersion: "19.09.37", hl: "en", gl: "US", androidSdkVersion: 30 },
          },
        }),
      }
    );

    if (playerRes.ok) {
      const playerData = await playerRes.json();
      const captionTracks =
        playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (captionTracks && captionTracks.length > 0) {
        const track =
          captionTracks.find(
            (t: { languageCode: string }) => t.languageCode === "en"
          ) || captionTracks[0];

        const capRes = await fetch(track.baseUrl);
        const xml = await capRes.text();
        if (xml && xml.length >= 50) {
          const matches = [
            ...xml.matchAll(new RegExp("<text[^>]*>(.*?)</text>", "gs")),
          ];
          if (matches.length > 0) {
            const transcript = matches
              .map((m) =>
                m[1]
                  .replace(/&amp;/g, "&")
                  .replace(/&lt;/g, "<")
                  .replace(/&gt;/g, ">")
                  .replace(/&#39;/g, "'")
                  .replace(/&quot;/g, '"')
                  .replace(/\n/g, " ")
              )
              .join(" ")
              .trim();
            if (transcript.length > 10) {
              console.log("[client] Direct extraction success:", transcript.length, "chars");
              return transcript;
            }
          }
        }
      }
    }
  } catch (e) {
    console.log("[client] Direct extraction failed:", (e as Error).message);
  }

  try {
    const proxyRes = await fetch("/api/transcript", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoId }),
    });
    if (proxyRes.ok) {
      const data = await proxyRes.json();
      if (data.transcript && data.transcript.length > 10) {
        console.log("[client] Server proxy success:", data.transcript.length, "chars");
        return data.transcript;
      }
    }
  } catch (e) {
    console.log("[client] Server proxy failed:", (e as Error).message);
  }

  return null;
}

// Fill hook text with variables
function fillHookText(text: string, vars: { day: string; sport: string; count: number }): string {
  return text
    .replace(/{day}/g, vars.day)
    .replace(/{sport}/g, vars.sport)
    .replace(/{count}/g, vars.count.toString());
}

// ── Main Component ──

export default function Home() {
  const [activeTab, setActiveTab] = useState<"transcript" | "picks">("transcript");

  // ── Transcript Tab State ──
  const [url, setUrl] = useState("");
  const [manualTranscript, setManualTranscript] = useState("");
  const [settings, setSettings] = useState<ScriptSettings>({
    targetSeconds: 60,
    style: "hype",
    includeGraphics: true,
    includeStats: true,
  });
  const [customHook, setCustomHook] = useState("");
  const [result, setResult] = useState<GeneratedResult | null>(null);
  const [editedSections, setEditedSections] = useState<ScriptSections | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [transcriptFallback, setTranscriptFallback] = useState(false);
  const [usage, setUsage] = useState<SessionUsage>({
    totalCost: 0, totalTokens: 0, generations: 0, since: new Date().toISOString(),
  });
  const [mounted, setMounted] = useState(false);

  // ── Picks Tab State ──
  const [picksSport, setPicksSport] = useState("NBA");
  const [picksDay, setPicksDay] = useState(getTodayDayName());
  const [picksDate, setPicksDate] = useState(getTodayDate());
  const [picksCount, setPicksCount] = useState(3);
  const [picksText, setPicksText] = useState("");
  const [picksTone, setPicksTone] = useState<HookData["tone"]>("hype");
  const [hooks, setHooks] = useState<HookData[]>([]);
  const [currentHookIndex, setCurrentHookIndex] = useState(0);
  const [hookLocked, setHookLocked] = useState(false);
  const [picksResult, setPicksResult] = useState<PicksScriptOutput | null>(null);
  const [picksLoading, setPicksLoading] = useState(false);
  const [picksError, setPicksError] = useState("");
  const [picksCopied, setPicksCopied] = useState(false);

  useEffect(() => {
    setUsage(loadUsage());
    setMounted(true);
  }, []);

  // Fetch hooks on mount
  useEffect(() => {
    fetch("/api/hooks")
      .then((res) => res.json())
      .then((data: HookData[]) => setHooks(data))
      .catch(() => {});
  }, []);

  // When result changes, initialize editable sections
  useEffect(() => {
    if (result?.sections) {
      setEditedSections({ ...result.sections });
    }
  }, [result]);

  // Filter hooks by tone
  const filteredHooks = useMemo(() => {
    return hooks.filter((h) => h.tone === picksTone);
  }, [hooks, picksTone]);

  // Reset hook index when tone changes
  useEffect(() => {
    if (!hookLocked) {
      setCurrentHookIndex(0);
    }
  }, [picksTone, hookLocked]);

  const currentHook = filteredHooks[currentHookIndex] || null;

  const filledHookPreview = useMemo(() => {
    if (!currentHook) return "";
    return fillHookText(currentHook.text, { day: picksDay, sport: picksSport, count: picksCount });
  }, [currentHook, picksDay, picksSport, picksCount]);

  const platform = useMemo(() => detectPlatform(url), [url]);
  const needsManualTranscript = platform === "instagram" || transcriptFallback;
  const canGenerate =
    url.trim() &&
    (!needsManualTranscript || manualTranscript.trim()) &&
    !loading;

  const editedFullScript = editedSections
    ? `${editedSections.hook}\n\n${editedSections.body}\n\n${editedSections.cta}`
    : "";
  const editedWordCount = wc(editedFullScript);
  const editedSeconds = Math.round(editedWordCount / 2.8);

  // ── Transcript Generate ──
  async function handleGenerate() {
    if (!canGenerate) return;
    setLoading(true);
    setError("");
    setResult(null);
    setEditedSections(null);

    try {
      let clientTranscript = manualTranscript.trim() || undefined;
      if (!clientTranscript && detectPlatform(url) === "youtube") {
        const videoId = extractVideoId(url.trim());
        if (videoId) {
          console.log("[client] Extracting transcript from browser...");
          const extracted = await clientExtractTranscript(videoId);
          if (extracted) {
            console.log("[client] Got transcript:", extracted.length, "chars");
            clientTranscript = extracted;
          } else {
            console.log("[client] Browser extraction failed, falling back to server");
          }
        }
      }

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          manualTranscript: clientTranscript,
          settings: { ...settings, customHook: customHook.trim() || undefined },
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

  // ── Picks Generate ──
  async function handlePicksGenerate() {
    const lines = picksText.trim().split("\n").filter(Boolean);
    if (lines.length === 0) {
      setPicksError("Enter at least one pick");
      return;
    }
    setPicksLoading(true);
    setPicksError("");
    setPicksResult(null);

    try {
      const res = await fetch("/api/generate-from-picks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          picks: lines,
          sport: picksSport,
          day: picksDay,
          date: picksDate,
          hookId: currentHook?.id,
          tone: picksTone,
          count: picksCount,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Script generation failed");
      }
      setPicksResult(data);
    } catch (err: unknown) {
      setPicksError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setPicksLoading(false);
    }
  }

  function resetUsage() {
    const fresh: SessionUsage = {
      totalCost: 0, totalTokens: 0, generations: 0, since: new Date().toISOString(),
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

  // Hook navigation
  const prevHook = useCallback(() => {
    if (hookLocked) return;
    setCurrentHookIndex((i) => (i > 0 ? i - 1 : filteredHooks.length - 1));
  }, [hookLocked, filteredHooks.length]);

  const nextHook = useCallback(() => {
    if (hookLocked) return;
    setCurrentHookIndex((i) => (i < filteredHooks.length - 1 ? i + 1 : 0));
  }, [hookLocked, filteredHooks.length]);

  const shuffleHook = useCallback(() => {
    if (hookLocked || filteredHooks.length <= 1) return;
    let newIdx: number;
    do {
      newIdx = Math.floor(Math.random() * filteredHooks.length);
    } while (newIdx === currentHookIndex);
    setCurrentHookIndex(newIdx);
  }, [hookLocked, filteredHooks.length, currentHookIndex]);

  // Rebuild timeline from edited sections
  const editedTimeline = useMemo((): EditingTimeline | null => {
    if (!editedSections || !result?.timeline) return null;
    const fps = result.timeline.fps;
    const clips: TimelineClip[] = [];
    let cursor = 0;

    const defs: { id: string; section: "hook" | "body" | "cta"; label: string; text: string }[] = [
      { id: "hook", section: "hook", label: "HOOK", text: editedSections.hook },
      { id: "body", section: "body", label: "BODY", text: editedSections.body },
      { id: "cta", section: "cta", label: "CTA", text: editedSections.cta },
    ];

    for (let i = 0; i < defs.length; i++) {
      const def = defs[i];
      if (!def.text) continue;
      const words = def.text.split(/\s+/).filter(Boolean).length;
      const dur = Math.round(words / 2.8);
      const overlays: string[] = [];
      for (const m of def.text.matchAll(/\[(GFX|STAT):\s*([^\]]+)\]/g)) {
        overlays.push(`[${m[1]}] ${m[2].trim()}`);
      }
      clips.push({
        id: def.id,
        section: def.section,
        label: def.label,
        startSec: cursor,
        endSec: cursor + dur,
        durationSec: dur,
        startFrame: Math.round(cursor * fps),
        endFrame: Math.round((cursor + dur) * fps),
        durationFrames: Math.round(dur * fps),
        text: def.text,
        wordCount: words,
        footage: result.backgroundFootage[i] || "",
        overlays,
      });
      cursor += dur;
    }

    return { fps, totalDurationSec: cursor, totalFrames: Math.round(cursor * fps), clips };
  }, [editedSections, result]);

  function exportTimelineJSON() {
    if (!editedTimeline) return;
    const blob = new Blob([JSON.stringify(editedTimeline, null, 2)], { type: "application/json" });
    const dlUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = dlUrl;
    a.download = `timeline-${result?.videoTitle?.replace(/[^a-z0-9]/gi, "-").toLowerCase() || "script"}.json`;
    a.click();
    URL.revokeObjectURL(dlUrl);
  }

  function copyTimelineJSON() {
    if (!editedTimeline) return;
    navigator.clipboard.writeText(JSON.stringify(editedTimeline, null, 2));
  }

  function copyPicksScript() {
    if (!picksResult) return;
    navigator.clipboard.writeText(picksResult.script);
    setPicksCopied(true);
    setTimeout(() => setPicksCopied(false), 2000);
  }

  function sendToVideoEngine() {
    if (!picksResult) return;
    const params = new URLSearchParams({
      script: picksResult.script,
      title: picksResult.title,
      hook: picksResult.hook,
    });
    window.open(`https://novig-video-engine.up.railway.app/?${params.toString()}`, "_blank");
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

      {/* Tab Switcher */}
      <div className="border-b border-white/10 px-6">
        <div className="max-w-6xl mx-auto flex gap-0">
          <button
            onClick={() => setActiveTab("transcript")}
            className={`px-5 py-3 text-sm font-medium transition-colors cursor-pointer border-b-2 ${
              activeTab === "transcript"
                ? "border-emerald-500 text-white"
                : "border-transparent text-white/40 hover:text-white/60"
            }`}
          >
            From Transcript
          </button>
          <button
            onClick={() => setActiveTab("picks")}
            className={`px-5 py-3 text-sm font-medium transition-colors cursor-pointer border-b-2 ${
              activeTab === "picks"
                ? "border-emerald-500 text-white"
                : "border-transparent text-white/40 hover:text-white/60"
            }`}
          >
            From Picks
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {/* ══════════════════════════════════════════════ */}
        {/* TRANSCRIPT TAB */}
        {/* ══════════════════════════════════════════════ */}
        {activeTab === "transcript" && (
          <>
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

              {/* Custom Hook */}
              <div className="space-y-1.5">
                <button
                  onClick={() => setCustomHook(customHook ? "" : " ")}
                  className="text-xs text-white/30 hover:text-white/50 transition-colors cursor-pointer"
                >
                  {customHook ? "- Remove custom hook" : "+ Write your own hook"}
                </button>
                {customHook !== "" && (
                  <textarea
                    value={customHook}
                    onChange={(e) => setCustomHook(e.target.value)}
                    placeholder='e.g. "This MAY BE CONTROVERSIAL, but NBA Wednesday might be the EASIEST path to a 3-0 sweep with these picks"'
                    rows={2}
                    className="w-full bg-amber-500/5 border border-amber-500/20 rounded-lg px-4 py-3 text-sm placeholder:text-white/20 text-amber-200/80 focus:outline-none focus:border-amber-500/40 focus:ring-1 focus:ring-amber-500/20 transition-colors resize-y font-[family-name:var(--font-geist-mono)]"
                  />
                )}
              </div>

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

                  {/* HOOK Section */}
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
                        Alternative Hooks -- click to swap
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

                  {/* BODY Section */}
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

                  {/* CTA Section */}
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

                  {/* Action buttons */}
                  <div className="flex gap-3">
                    <button
                      onClick={copyFullScript}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-500 py-3 rounded-lg text-sm font-medium transition-colors cursor-pointer"
                    >
                      Copy Script
                    </button>
                    {editedTimeline && (
                      <button
                        onClick={exportTimelineJSON}
                        className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 py-3 rounded-lg text-sm font-medium transition-colors cursor-pointer"
                      >
                        Export Timeline
                      </button>
                    )}
                  </div>

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

                  {/* Editing Timeline */}
                  {editedTimeline && (
                    <Panel title="Editing Timeline">
                      <div className="space-y-3">
                        {/* Visual timeline bar */}
                        <div className="flex rounded-md overflow-hidden h-6">
                          {editedTimeline.clips.map((clip) => {
                            const pct = editedTimeline.totalDurationSec > 0
                              ? (clip.durationSec / editedTimeline.totalDurationSec) * 100
                              : 0;
                            const colors: Record<string, string> = {
                              hook: "bg-amber-500",
                              body: "bg-emerald-500",
                              cta: "bg-blue-500",
                            };
                            return (
                              <div
                                key={clip.id}
                                className={`${colors[clip.section]} flex items-center justify-center text-[10px] font-bold text-black/70`}
                                style={{ width: `${pct}%` }}
                                title={`${clip.label}: ${clip.startSec}s-${clip.endSec}s`}
                              >
                                {clip.label}
                              </div>
                            );
                          })}
                        </div>

                        {/* Clip details */}
                        {editedTimeline.clips.map((clip) => {
                          const borderColors: Record<string, string> = {
                            hook: "border-amber-500/20",
                            body: "border-emerald-500/20",
                            cta: "border-blue-500/20",
                          };
                          const textColors: Record<string, string> = {
                            hook: "text-amber-400",
                            body: "text-emerald-400",
                            cta: "text-blue-400",
                          };
                          return (
                            <div
                              key={clip.id}
                              className={`border ${borderColors[clip.section]} rounded-md p-2.5 space-y-1`}
                            >
                              <div className="flex items-center justify-between">
                                <span className={`text-xs font-semibold ${textColors[clip.section]}`}>
                                  {clip.label}
                                </span>
                                <span className="text-[10px] text-white/30 font-mono">
                                  {clip.startSec}s - {clip.endSec}s
                                </span>
                              </div>
                              <div className="text-[10px] text-white/30 font-mono">
                                frames {clip.startFrame}-{clip.endFrame} ({clip.durationFrames}f @ {editedTimeline.fps}fps)
                              </div>
                              {clip.footage && (
                                <div className="text-[11px] text-white/40">
                                  B-roll: {clip.footage}
                                </div>
                              )}
                              {clip.overlays.length > 0 && (
                                <div className="text-[11px] text-white/40">
                                  {clip.overlays.map((o, i) => (
                                    <div key={i}>{o}</div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {/* Export buttons */}
                        <div className="flex gap-2 pt-1">
                          <button
                            onClick={exportTimelineJSON}
                            className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 py-2 rounded-md text-xs font-medium transition-colors cursor-pointer"
                          >
                            Download JSON
                          </button>
                          <button
                            onClick={copyTimelineJSON}
                            className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 py-2 rounded-md text-xs font-medium transition-colors cursor-pointer"
                          >
                            Copy JSON
                          </button>
                        </div>

                        <div className="text-[10px] text-white/20 leading-relaxed">
                          Compatible with Remotion, After Effects (via script), Premiere markers, DaVinci Resolve edit lists.
                        </div>
                      </div>
                    </Panel>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/* ══════════════════════════════════════════════ */}
        {/* PICKS TAB */}
        {/* ══════════════════════════════════════════════ */}
        {activeTab === "picks" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Left Panel -- Inputs */}
            <div className="space-y-6">
              {/* Sport */}
              <div className="space-y-2">
                <label className="text-xs text-white/40 uppercase tracking-wider">Sport</label>
                <div className="flex gap-2">
                  {SPORT_OPTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => setPicksSport(s)}
                      className={`px-4 py-2 text-sm rounded-lg font-medium transition-colors cursor-pointer ${
                        picksSport === s
                          ? "bg-emerald-600 text-white"
                          : "bg-white/5 text-white/50 hover:text-white/80"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Day + Date */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs text-white/40 uppercase tracking-wider">Day</label>
                  <input
                    type="text"
                    value={picksDay}
                    onChange={(e) => setPicksDay(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm placeholder:text-white/30 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/25 transition-colors"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-white/40 uppercase tracking-wider">Date</label>
                  <input
                    type="text"
                    value={picksDate}
                    onChange={(e) => setPicksDate(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm placeholder:text-white/30 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/25 transition-colors"
                  />
                </div>
              </div>

              {/* Number of Picks */}
              <div className="space-y-2">
                <label className="text-xs text-white/40 uppercase tracking-wider">Number of Picks</label>
                <div className="flex gap-2">
                  {PICK_COUNT_OPTIONS.map((n) => (
                    <button
                      key={n}
                      onClick={() => setPicksCount(n)}
                      className={`px-4 py-2 text-sm rounded-lg font-medium transition-colors cursor-pointer ${
                        picksCount === n
                          ? "bg-emerald-600 text-white"
                          : "bg-white/5 text-white/50 hover:text-white/80"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              {/* Picks Textarea */}
              <div className="space-y-2">
                <label className="text-xs text-white/40 uppercase tracking-wider">Picks (one per line)</label>
                <textarea
                  value={picksText}
                  onChange={(e) => setPicksText(e.target.value)}
                  placeholder={"Warriors -4.5\nCeltics ML\nLakers vs Nuggets Over 224.5"}
                  rows={5}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm placeholder:text-white/30 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/25 transition-colors resize-y font-[family-name:var(--font-geist-mono)]"
                />
              </div>

              {/* Tone */}
              <div className="space-y-2">
                <label className="text-xs text-white/40 uppercase tracking-wider">Tone</label>
                <div className="flex flex-wrap gap-2">
                  {TONE_OPTIONS.map((t) => (
                    <button
                      key={t}
                      onClick={() => setPicksTone(t)}
                      className={`px-4 py-2 text-sm rounded-lg font-medium transition-colors cursor-pointer capitalize ${
                        picksTone === t
                          ? "bg-emerald-600 text-white"
                          : "bg-white/5 text-white/50 hover:text-white/80"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* Hook Preview */}
              {currentHook && (
                <div className="space-y-2">
                  <label className="text-xs text-white/40 uppercase tracking-wider">Hook Preview</label>
                  <div className="bg-[#00FF00]/[0.07] border border-[#00FF00]/20 rounded-lg p-4">
                    <p className="text-sm text-[#00FF00]/90 leading-relaxed font-medium">
                      {filledHookPreview}
                    </p>
                    <div className="flex items-center gap-2 mt-3">
                      <button
                        onClick={prevHook}
                        disabled={hookLocked}
                        className="px-3 py-1.5 text-xs rounded-md bg-white/5 text-white/50 hover:text-white/80 disabled:opacity-30 transition-colors cursor-pointer"
                      >
                        Prev
                      </button>
                      <button
                        onClick={shuffleHook}
                        disabled={hookLocked}
                        className="px-3 py-1.5 text-xs rounded-md bg-white/5 text-white/50 hover:text-white/80 disabled:opacity-30 transition-colors cursor-pointer"
                      >
                        Shuffle
                      </button>
                      <button
                        onClick={() => setHookLocked(!hookLocked)}
                        className={`px-3 py-1.5 text-xs rounded-md transition-colors cursor-pointer ${
                          hookLocked
                            ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                            : "bg-white/5 text-white/50 hover:text-white/80"
                        }`}
                      >
                        {hookLocked ? "Locked" : "Lock"}
                      </button>
                      <button
                        onClick={nextHook}
                        disabled={hookLocked}
                        className="px-3 py-1.5 text-xs rounded-md bg-white/5 text-white/50 hover:text-white/80 disabled:opacity-30 transition-colors cursor-pointer"
                      >
                        Next
                      </button>
                      <span className="text-xs text-white/20 ml-auto">
                        {currentHookIndex + 1}/{filteredHooks.length}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Generate Button */}
              <button
                onClick={handlePicksGenerate}
                disabled={picksLoading || !picksText.trim()}
                className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-white/10 disabled:text-white/30 px-6 py-3 rounded-lg text-sm font-medium transition-colors cursor-pointer"
              >
                {picksLoading ? "Generating..." : "Generate Script"}
              </button>

              {picksError && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg text-sm">
                  {picksError}
                </div>
              )}
            </div>

            {/* Right Panel -- Output */}
            <div className="space-y-4">
              {picksLoading && (
                <div className="flex items-center justify-center py-20">
                  <div className="space-y-3 text-center">
                    <div className="w-8 h-8 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin mx-auto" />
                    <p className="text-sm text-white/40">Generating script from picks...</p>
                  </div>
                </div>
              )}

              {picksResult && !picksLoading && (
                <div className="space-y-4">
                  {/* Title */}
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400">
                      {picksResult.title}
                    </span>
                    <span className="text-white/40">{picksResult.date}</span>
                  </div>

                  {/* Hook highlight */}
                  <div className="bg-[#00FF00]/[0.07] border border-[#00FF00]/20 rounded-lg p-4">
                    <span className="text-xs text-[#00FF00]/50 uppercase tracking-wider block mb-2">Hook</span>
                    <p className="text-sm text-[#00FF00]/90 font-medium leading-relaxed">
                      {picksResult.hook}
                    </p>
                  </div>

                  {/* Full script */}
                  <div className="bg-white/[0.03] border border-white/10 rounded-lg p-4">
                    <span className="text-xs text-white/40 uppercase tracking-wider block mb-3">Full Script</span>
                    <p className="text-sm text-white/80 leading-relaxed whitespace-pre-wrap font-[family-name:var(--font-geist-mono)]">
                      {picksResult.script}
                    </p>
                  </div>

                  {/* Stats */}
                  <div className="flex gap-3">
                    <Stat label="Words" value={picksResult.wordCount.toString()} />
                    <Stat label="Duration" value={`${picksResult.estimatedDuration}s`} />
                    <Stat label="Picks" value={picksResult.picks.length.toString()} />
                  </div>

                  {/* Teams & Players */}
                  {(picksResult.teams.length > 0 || picksResult.players.length > 0) && (
                    <div className="bg-white/[0.03] border border-white/5 rounded-lg p-4 space-y-2">
                      {picksResult.teams.length > 0 && (
                        <div className="text-xs">
                          <span className="text-white/30">Teams: </span>
                          <span className="text-white/60">{picksResult.teams.join(", ")}</span>
                        </div>
                      )}
                      {picksResult.players.length > 0 && (
                        <div className="text-xs">
                          <span className="text-white/30">Players: </span>
                          <span className="text-white/60">{picksResult.players.join(", ")}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Parsed Picks */}
                  {picksResult.picks.length > 0 && (
                    <div className="bg-white/[0.03] border border-white/5 rounded-lg p-4">
                      <span className="text-xs text-white/40 uppercase tracking-wider block mb-2">Parsed Picks</span>
                      <div className="space-y-1.5">
                        {picksResult.picks.map((p, i) => (
                          <div key={i} className="flex items-center gap-3 text-sm">
                            <span className="text-emerald-500/60 text-xs">{i + 1}.</span>
                            <span className="text-white/70">{p.team}</span>
                            <span className="text-white/40">{p.line}</span>
                            <span className="text-xs px-1.5 py-0.5 rounded bg-white/5 text-white/30">{p.type}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex gap-3">
                    <button
                      onClick={copyPicksScript}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-500 py-3 rounded-lg text-sm font-medium transition-colors cursor-pointer"
                    >
                      {picksCopied ? "Copied!" : "Copy Script"}
                    </button>
                    <button
                      onClick={sendToVideoEngine}
                      className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 py-3 rounded-lg text-sm font-medium transition-colors cursor-pointer"
                    >
                      Send to Video Engine
                    </button>
                  </div>

                  {/* Regenerate */}
                  <button
                    onClick={handlePicksGenerate}
                    disabled={picksLoading}
                    className="w-full bg-white/5 hover:bg-white/10 border border-white/10 py-2.5 rounded-lg text-xs font-medium text-white/50 transition-colors cursor-pointer"
                  >
                    Regenerate{hookLocked ? " (hook locked)" : ""}
                  </button>
                </div>
              )}

              {!picksResult && !picksLoading && (
                <div className="flex items-center justify-center py-20">
                  <p className="text-sm text-white/20">
                    Enter your picks and generate a script
                  </p>
                </div>
              )}
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
