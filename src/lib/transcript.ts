import { YoutubeTranscript } from "youtube-transcript";

export interface VideoMeta {
  videoId: string;
  title: string;
  channel: string;
  platform: "youtube" | "instagram" | "manual";
}

// ── URL Parsing ──

function extractYouTubeVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/live\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

function extractIgUsername(url: string): string {
  const match = url.match(/instagram\.com\/([^/?]+)/);
  return match ? `@${match[1]}` : "Instagram";
}

function detectPlatform(url: string): "youtube" | "instagram" | null {
  if (/youtube\.com|youtu\.be/i.test(url)) return "youtube";
  if (/instagram\.com/i.test(url)) return "instagram";
  return null;
}

// ── YouTube Metadata ──

async function fetchYouTubeMeta(videoId: string): Promise<{
  title: string;
  channel: string;
}> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
    );
    if (res.ok) {
      const data = await res.json();
      return {
        title: data.title || "Unknown Title",
        channel: data.author_name || "Unknown Channel",
      };
    }
  } catch {}
  return { title: "Unknown Title", channel: "Unknown Channel" };
}

// ── Method 1: YouTube Captions (free, instant) ──

async function tryYouTubeCaptions(videoId: string): Promise<string | null> {
  try {
    const items = await YoutubeTranscript.fetchTranscript(videoId, {
      lang: "en",
    });
    if (items && items.length > 0) {
      const text = items.map((i) => i.text).join(" ");
      if (text.trim().length > 10) return text;
    }
  } catch (e) {
    console.log(
      `[transcript] Captions unavailable for ${videoId}:`,
      (e as Error).message
    );
  }
  return null;
}

// ── Method 2: Gemini YouTube URL transcription (works from any IP) ──

async function tryGeminiVideoTranscription(
  videoId: string
): Promise<string | null> {
  try {
    console.log(`[transcript] Trying Gemini video transcription for ${videoId}...`);
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-001",
        messages: [
          {
            role: "user",
            content: `Please transcribe the spoken words in this YouTube video verbatim. Output ONLY the transcript text, nothing else. No timestamps, no labels, no commentary. Video: ${videoUrl}`,
          },
        ],
        max_tokens: 4000,
        temperature: 0,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.log(`[transcript] Gemini video API error: ${res.status} ${errText.substring(0, 200)}`);
      return null;
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim();
    if (text && text.length > 10) {
      console.log(`[transcript] Gemini video transcription success: ${text.length} chars`);
      return text;
    }
    console.log(`[transcript] Gemini returned empty/short response`);
    return null;
  } catch (e) {
    console.log(`[transcript] Gemini video transcription error: ${(e as Error).message}`);
    return null;
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

// Store last error for debugging
let _lastAudioError = "";
export function getLastAudioError(): string {
  return _lastAudioError;
}

// ── Main Entry Point ──

export async function fetchTranscript(
  url: string,
  manualTranscript?: string
): Promise<{
  transcript: string;
  meta: VideoMeta;
}> {
  const platform = detectPlatform(url);

  // Manual transcript always wins
  if (manualTranscript?.trim()) {
    if (platform === "youtube") {
      const videoId = extractYouTubeVideoId(url) || "unknown";
      const { title, channel } = await fetchYouTubeMeta(videoId);
      return {
        transcript: manualTranscript.trim(),
        meta: { videoId, title, channel, platform: "youtube" },
      };
    }
    if (platform === "instagram") {
      const igMatch = url.match(/\/(p|reel|reels)\/([A-Za-z0-9_-]+)/);
      const videoId = igMatch ? igMatch[2] : "ig_unknown";
      return {
        transcript: manualTranscript.trim(),
        meta: {
          videoId,
          title: "Instagram Video",
          channel: extractIgUsername(url),
          platform: "instagram",
        },
      };
    }
    return {
      transcript: manualTranscript.trim(),
      meta: {
        videoId: "manual",
        title: "Manual Input",
        channel: "Direct Paste",
        platform: "manual",
      },
    };
  }

  // ── YouTube: captions → Gemini video transcription ──
  if (platform === "youtube") {
    const videoId = extractYouTubeVideoId(url);
    if (!videoId) throw new Error("Invalid YouTube URL.");
    const { title, channel } = await fetchYouTubeMeta(videoId);

    // Try captions first (fastest, cheapest)
    const captions = await tryYouTubeCaptions(videoId);
    if (captions) {
      return {
        transcript: captions,
        meta: { videoId, title, channel, platform: "youtube" },
      };
    }

    // Gemini can natively process YouTube videos by URL — no audio download needed
    const geminiTranscript = await withTimeout(
      tryGeminiVideoTranscription(videoId),
      45000,
      "Gemini video transcription"
    );
    if (geminiTranscript) {
      _lastAudioError = "";
      return {
        transcript: geminiTranscript,
        meta: { videoId, title, channel, platform: "youtube" },
      };
    }

    _lastAudioError = "Both captions and Gemini video transcription failed";
    throw new Error(
      "Could not transcribe this video. Captions unavailable and AI transcription failed."
    );
  }

  // ── Instagram: manual only for now ──
  if (platform === "instagram") {
    throw new Error(
      "Instagram videos require a manual transcript. Paste what they say in the box below."
    );
  }

  throw new Error("Unsupported URL. Provide a YouTube or Instagram link.");
}
