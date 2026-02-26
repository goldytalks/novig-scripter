import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

// Parse caption XML — handles both <text> (manual) and <p><s> (ASR) formats
function parseCaptionXml(xml: string): string {
  // Try <text> tags first (manual captions)
  const textMatches = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)];
  if (textMatches.length > 0) {
    const t = textMatches
      .map((m) => m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\n/g, " "))
      .join(" ").trim();
    if (t.length > 10) return t;
  }
  // Try <p><s> tags (ASR auto-generated captions)
  const pMatches = [...xml.matchAll(/<p [^>]*>([\s\S]*?)<\/p>/g)];
  if (pMatches.length > 0) {
    const words: string[] = [];
    for (const pm of pMatches) {
      const sMatches = [...pm[1].matchAll(/<s[^>]*>([\s\S]*?)<\/s>/g)];
      for (const sm of sMatches) {
        const word = sm[1].replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\n/g, " ").trim();
        if (word) words.push(word);
      }
    }
    return words.join(" ").trim();
  }
  return "";
}

// Server-side proxy for YouTube transcript extraction
// Two modes:
// 1. { videoId, captionUrl } — client got the caption URL from browser Innertube call, server just fetches the XML
// 2. { videoId } — full server-side extraction via Innertube ANDROID client
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { videoId, captionUrl } = body as { videoId: string; captionUrl?: string };

    if (!videoId || typeof videoId !== "string") {
      return NextResponse.json({ error: "Missing videoId" }, { status: 400 });
    }

    // Mode 1: Client provided the caption URL — just fetch and parse the XML
    // This works even from Vercel because the timedtext API isn't IP-blocked
    if (captionUrl && typeof captionUrl === "string" && captionUrl.includes("youtube.com/api/timedtext")) {
      console.log(`[transcript-proxy] Fetching client-provided caption URL for ${videoId}`);
      const capRes = await fetch(captionUrl);
      if (!capRes.ok) {
        return NextResponse.json({ error: "caption_fetch_failed", status: capRes.status }, { status: 502 });
      }
      const xml = await capRes.text();
      if (!xml || xml.length < 50) {
        return NextResponse.json({ error: "empty_captions" }, { status: 404 });
      }
      const transcript = parseCaptionXml(xml);
      if (transcript.length < 10) {
        return NextResponse.json({ error: "transcript_too_short" }, { status: 404 });
      }
      return NextResponse.json({ transcript });
    }

    // Mode 2: Full server-side extraction via Innertube ANDROID client
    console.log(`[transcript-proxy] Full server extraction for ${videoId}`);
    const playerRes = await fetch(
      "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId,
          context: {
            client: {
              clientName: "ANDROID",
              clientVersion: "19.09.37",
              hl: "en",
              gl: "US",
              androidSdkVersion: 30,
            },
          },
        }),
      }
    );

    if (!playerRes.ok) {
      return NextResponse.json({ error: "YouTube API error", status: playerRes.status }, { status: 502 });
    }

    const playerData = await playerRes.json();

    if (
      playerData?.playabilityStatus?.status === "LOGIN_REQUIRED" ||
      playerData?.playabilityStatus?.reason?.includes("Sign in")
    ) {
      return NextResponse.json(
        { error: "blocked", message: "YouTube blocked this request from the server" },
        { status: 403 }
      );
    }

    const captionTracks =
      playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!captionTracks || captionTracks.length === 0) {
      return NextResponse.json({ error: "no_captions" }, { status: 404 });
    }

    const track =
      captionTracks.find((t: { languageCode: string }) => t.languageCode === "en") || captionTracks[0];

    const capRes = await fetch(track.baseUrl);
    const xml = await capRes.text();
    if (!xml || xml.length < 50) {
      return NextResponse.json({ error: "empty_captions" }, { status: 404 });
    }

    const transcript = parseCaptionXml(xml);
    if (transcript.length < 10) {
      return NextResponse.json({ error: "transcript_too_short" }, { status: 404 });
    }

    return NextResponse.json({ transcript });
  } catch (err) {
    console.error("Transcript proxy error:", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
