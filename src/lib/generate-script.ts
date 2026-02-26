import OpenAI from "openai";

export interface ScriptSettings {
  targetSeconds: number;
  style: "hype" | "analytical" | "conversational";
  includeGraphics: boolean;
  includeStats: boolean;
  customHook?: string;
}

export interface UsageInfo {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

export interface ScriptSections {
  hook: string;
  body: string;
  cta: string;
}

export interface TimelineClip {
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

export interface EditingTimeline {
  fps: number;
  totalDurationSec: number;
  totalFrames: number;
  clips: TimelineClip[];
}

export interface GeneratedScript {
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
  usage: UsageInfo[];
  totalCost: number;
}

const WORDS_PER_SECOND = 2.8;
const SCRIPT_MODEL = "anthropic/claude-sonnet-4";

function getClient(): OpenAI {
  return new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY,
  });
}

function buildSystemPrompt(settings: ScriptSettings): string {
  const wordTarget = Math.round(settings.targetSeconds * WORDS_PER_SECOND);
  const hookWords = Math.round(3 * WORDS_PER_SECOND); // ~3 seconds
  const ctaWords = Math.round(4 * WORDS_PER_SECOND); // ~4 seconds
  const bodyWords = wordTarget - hookWords - ctaWords;

  const styleGuide: Record<string, string> = {
    hype: "High energy, punchy, confident. Short sentences. Build excitement. Use bold claims and urgency.",
    analytical:
      "Data-driven, precise, authoritative. Reference numbers and trends. Sound like a sharp.",
    conversational:
      "Casual, relatable, like talking to a friend at a sportsbook. Natural flow.",
  };

  const graphicsInstructions =
    settings.includeGraphics || settings.includeStats
      ? `\n${settings.includeStats ? "- Add [STAT: ...] markers where on-screen stats should appear." : ""}${settings.includeGraphics ? "\n- Add [GFX: ...] markers where visual overlays should appear." : ""}`
      : "";

  const customHook = settings.customHook?.trim();
  const hookInstruction = customHook
    ? `(USE THIS EXACT HOOK — do not modify it:\n"${customHook}")`
    : `(~${hookWords} words, ~3 seconds. This is THE most important part. Make it controversial, bold, or create FOMO. Examples of great hooks:
- "This MAY BE CONTROVERSIAL, but NBA Wednesday might be the EASIEST path to a 3-0 sweep"
- "Everyone's sleeping on this prop and it's basically free money"
- "I found a stat that Vegas doesn't want you to see"
- "Three picks. One night. Zero losses. Here's the play."
The hook must STOP THE SCROLL. No "hey guys", no "what's up". Make a bold claim or tease the payoff.)`;

  return `You write short-form sports betting video scripts for Novig (zero-vig betting exchange, fairest odds).

VOICE: ${styleGuide[settings.style]}

Rewrite the transcript into a ${settings.targetSeconds}s script (~${wordTarget} words) with CLEARLY SEPARATED SECTIONS.

OUTPUT THE SCRIPT IN EXACTLY THIS FORMAT:

[HOOK]
${hookInstruction}

[BODY]
(~${bodyWords} words. The actual picks, analysis, and reasoning. This is where the substance lives.)

[CTA]
(~${ctaWords} words. Always end with: "Stop leaving money on the table. Get the best odds on Novig — link in bio.")

RULES:
- Preserve ALL picks, odds, teams, spreads, totals, props, numbers from the transcript. Never fabricate.
- Cut filler. Tighten for short-form pacing.
- Max 2 natural Novig mentions (one can be in the body, one in CTA).
- Target ~${wordTarget} words total.${graphicsInstructions}

After the script sections, add a --- separator, then output JSON on a single line:
{"footage":["3-5 b-roll suggestions"],"notes":["3-5 production tips"],"hookAlts":["3 alternative hook lines that could replace the main hook"]}

Return the sections first, then --- then the JSON. Nothing else.`;
}

function parseSections(raw: string): ScriptSections {
  const hookMatch = raw.match(/\[HOOK\]\s*\n([\s\S]*?)(?=\[BODY\])/i);
  const bodyMatch = raw.match(/\[BODY\]\s*\n([\s\S]*?)(?=\[CTA\])/i);
  const ctaMatch = raw.match(/\[CTA\]\s*\n([\s\S]*?)(?=---|$)/i);

  return {
    hook: hookMatch ? hookMatch[1].trim() : "",
    body: bodyMatch ? bodyMatch[1].trim() : "",
    cta: ctaMatch ? ctaMatch[1].trim() : "Stop leaving money on the table. Get the best odds on Novig — link in bio.",
  };
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export async function generateScript(
  transcript: string,
  videoTitle: string,
  channel: string,
  settings: ScriptSettings
): Promise<GeneratedScript> {
  const client = getClient();
  const truncated = transcript.slice(0, 12000);

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt(settings) },
    {
      role: "user",
      content: `Video: "${videoTitle}"\nSource: ${channel}\n\nTranscript:\n${truncated}`,
    },
  ];

  const response = await client.chat.completions.create({
    model: SCRIPT_MODEL,
    max_tokens: 2000,
    temperature: 0.5, // slightly higher for more creative hooks
    messages,
  });

  const raw = response.choices[0]?.message?.content || "";
  const promptTokens = response.usage?.prompt_tokens || 0;
  const completionTokens = response.usage?.completion_tokens || 0;
  const cost = (promptTokens * 3 + completionTokens * 15) / 1_000_000;

  // Parse sections
  const jsonSplit = raw.split(/\n---\n?/);
  const scriptPart = jsonSplit[0];
  const sections = parseSections(scriptPart);

  // Parse production JSON
  let footage: string[] = [];
  let notes: string[] = [];
  let hookAlts: string[] = [];

  if (jsonSplit[1]) {
    try {
      const parsed = JSON.parse(jsonSplit[1].trim());
      footage = parsed.footage || [];
      notes = parsed.notes || [];
      hookAlts = parsed.hookAlts || [];
    } catch {
      footage = ["Game highlights relevant to picks mentioned"];
      notes = ["Use quick cuts every 3-4s", "Add energetic background music"];
    }
  }

  const fullScript = `${sections.hook}\n\n${sections.body}\n\n${sections.cta}`;
  const totalWords = wordCount(fullScript);
  const estimatedSeconds = Math.round(totalWords / WORDS_PER_SECOND);
  const hookSeconds = Math.round(wordCount(sections.hook) / WORDS_PER_SECOND);
  const bodySeconds = Math.round(wordCount(sections.body) / WORDS_PER_SECOND);
  const ctaSeconds = Math.round(wordCount(sections.cta) / WORDS_PER_SECOND);

  const graphicsNeeded: string[] = [];
  for (const match of fullScript.matchAll(/\[(GFX|STAT):\s*([^\]]+)\]/g)) {
    graphicsNeeded.push(match[2].trim());
  }

  // Build editing timeline
  const FPS = 30;
  const timeline = buildTimeline(
    sections,
    { hookSeconds, bodySeconds, ctaSeconds },
    footage,
    graphicsNeeded,
    FPS
  );

  return {
    sections,
    fullScript,
    wordCount: totalWords,
    estimatedSeconds,
    hookSeconds,
    bodySeconds,
    ctaSeconds,
    backgroundFootage: footage,
    graphicsNeeded,
    productionNotes: notes,
    hookAlternatives: hookAlts,
    timeline,
    usage: [
      {
        model: SCRIPT_MODEL,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        estimatedCost: cost,
      },
    ],
    totalCost: cost,
  };
}

function buildTimeline(
  sections: ScriptSections,
  durations: { hookSeconds: number; bodySeconds: number; ctaSeconds: number },
  footage: string[],
  graphics: string[],
  fps: number
): EditingTimeline {
  let cursor = 0;
  const clips: TimelineClip[] = [];

  const sectionDefs: {
    id: string;
    section: "hook" | "body" | "cta";
    label: string;
    text: string;
    dur: number;
  }[] = [
    { id: "hook", section: "hook", label: "HOOK", text: sections.hook, dur: durations.hookSeconds },
    { id: "body", section: "body", label: "BODY", text: sections.body, dur: durations.bodySeconds },
    { id: "cta", section: "cta", label: "CTA", text: sections.cta, dur: durations.ctaSeconds },
  ];

  for (const def of sectionDefs) {
    if (!def.text) continue;
    const startSec = cursor;
    const endSec = cursor + def.dur;

    // Collect overlays for this section
    const overlays: string[] = [];
    for (const m of def.text.matchAll(/\[(GFX|STAT):\s*([^\]]+)\]/g)) {
      overlays.push(`[${m[1]}] ${m[2].trim()}`);
    }

    clips.push({
      id: def.id,
      section: def.section,
      label: def.label,
      startSec,
      endSec,
      durationSec: def.dur,
      startFrame: Math.round(startSec * fps),
      endFrame: Math.round(endSec * fps),
      durationFrames: Math.round(def.dur * fps),
      text: def.text,
      wordCount: def.text.split(/\s+/).filter(Boolean).length,
      footage: footage[clips.length] || "",
      overlays,
    });
    cursor = endSec;
  }

  return {
    fps,
    totalDurationSec: cursor,
    totalFrames: Math.round(cursor * fps),
    clips,
  };
}
