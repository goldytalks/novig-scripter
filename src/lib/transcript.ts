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

// ── Method 2: Google Gemini API with native YouTube video processing ──
// This uses the Gemini API directly (not OpenRouter) because only the native
// API actually processes YouTube video content. OpenRouter just passes text.

async function tryGeminiNativeTranscription(
  videoId: string
): Promise<string | null> {
  const apiKey = process.env.GOOGLE_AI_KEY;
  if (!apiKey) {
    console.log("[transcript] No GOOGLE_AI_KEY configured, skipping Gemini native");
    return null;
  }

  try {
    console.log(`[transcript] Trying Gemini native API for ${videoId}...`);
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: "Transcribe the spoken words in this video verbatim in English. Output ONLY the transcript text. No timestamps, labels, or commentary.",
                },
                {
                  fileData: {
                    mimeType: "video/*",
                    fileUri: videoUrl,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 4000,
          },
        }),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.log(`[transcript] Gemini native API error: ${res.status} ${errText.substring(0, 200)}`);
      return null;
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (text && text.length > 10) {
      console.log(`[transcript] Gemini native success: ${text.length} chars`);
      return text;
    }
    console.log("[transcript] Gemini native returned empty response");
    return null;
  } catch (e) {
    console.log(`[transcript] Gemini native error: ${(e as Error).message}`);
    return null;
  }
}

// ── Method 3: Invidious captions (free proxy, no auth) ──

async function tryInvidiousCaptions(videoId: string): Promise<string | null> {
  const instances = [
    "https://inv.nadeko.net",
    "https://iv.ggtyler.dev",
    "https://invidious.nerdvpn.de",
    "https://invidious.lunar.icu",
  ];

  for (const base of instances) {
    try {
      const res = await fetch(`${base}/api/v1/captions/${videoId}`, {
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const captions = data.captions || [];
      if (captions.length === 0) continue;

      // Prefer English, fall back to first available
      const enCap = captions.find(
        (c: { languageCode: string }) => c.languageCode === "en"
      ) || captions[0];

      const capUrl = enCap.url.startsWith("http")
        ? enCap.url
        : base + enCap.url;
      const capRes = await fetch(capUrl, { signal: AbortSignal.timeout(5000) });
      const xml = await capRes.text();
      if (xml.length < 50) continue;

      // Parse XML captions
      const textMatches = [...xml.matchAll(new RegExp("<text[^>]*>(.*?)</text>", "gs"))];
      if (textMatches.length === 0) continue;
      const transcript = textMatches
        .map((m) =>
          m[1]
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&#39;/g, "'")
            .replace(/&quot;/g, '"')
        )
        .join(" ")
        .trim();
      if (transcript.length > 10) {
        console.log(`[transcript] Invidious (${base}) success: ${transcript.length} chars`);
        return transcript;
      }
    } catch (e) {
      console.log(`[transcript] Invidious ${base} error: ${(e as Error).message.substring(0, 60)}`);
    }
  }
  return null;
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} timed out after ${ms}ms`)),
        ms
      )
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

  // ── YouTube: captions → Gemini native → Invidious ──
  if (platform === "youtube") {
    const videoId = extractYouTubeVideoId(url);
    if (!videoId) throw new Error("Invalid YouTube URL.");
    const { title, channel } = await fetchYouTubeMeta(videoId);

    // 1. Try YouTube captions (fastest, free)
    const captions = await tryYouTubeCaptions(videoId);
    if (captions) {
      return {
        transcript: captions,
        meta: { videoId, title, channel, platform: "youtube" },
      };
    }

    // 2. Try Gemini native API (actually processes the video)
    const geminiTranscript = await withTimeout(
      tryGeminiNativeTranscription(videoId),
      50000,
      "Gemini native transcription"
    ).catch(() => null);
    if (geminiTranscript) {
      _lastAudioError = "";
      return {
        transcript: geminiTranscript,
        meta: { videoId, title, channel, platform: "youtube" },
      };
    }

    // 3. Try Invidious captions
    const invidiousTranscript = await tryInvidiousCaptions(videoId);
    if (invidiousTranscript) {
      _lastAudioError = "";
      return {
        transcript: invidiousTranscript,
        meta: { videoId, title, channel, platform: "youtube" },
      };
    }

    _lastAudioError = "All transcript methods failed. Ensure GOOGLE_AI_KEY is set.";
    throw new Error(
      "Could not transcribe this video. Paste the transcript manually, or check that GOOGLE_AI_KEY is configured."
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
