import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

// Server-side proxy for YouTube transcript extraction
// Called by the client when direct browser extraction fails (CORS)
export async function POST(req: NextRequest) {
  try {
    const { videoId } = await req.json();
    if (!videoId || typeof videoId !== "string") {
      return NextResponse.json({ error: "Missing videoId" }, { status: 400 });
    }

    // Try innertube player API to get caption tracks
    const playerRes = await fetch(
      "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
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
      return NextResponse.json(
        { error: "YouTube API error", status: playerRes.status },
        { status: 502 }
      );
    }

    const playerData = await playerRes.json();

    // Check for bot challenge
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

    // Prefer English
    const track =
      captionTracks.find(
        (t: { languageCode: string }) => t.languageCode === "en"
      ) || captionTracks[0];

    // Fetch caption XML
    const capRes = await fetch(track.baseUrl);
    const xml = await capRes.text();
    if (!xml || xml.length < 50) {
      return NextResponse.json({ error: "empty_captions" }, { status: 404 });
    }

    // Parse XML — handle both <text> (manual) and <p><s> (ASR) formats
    let transcript = "";

    // Try <text> tags first (manual captions)
    const textMatches = [...xml.matchAll(/<text[^>]*>(.*?)<\/text>/gs)];
    if (textMatches.length > 0) {
      transcript = textMatches
        .map((m) => m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\n/g, " "))
        .join(" ").trim();
    }

    // Try <p><s> tags (ASR auto-generated captions)
    if (!transcript) {
      const pMatches = [...xml.matchAll(/<p [^>]*>([\s\S]*?)<\/p>/gs)];
      const words: string[] = [];
      for (const pm of pMatches) {
        const sMatches = [...pm[1].matchAll(/<s[^>]*>(.*?)<\/s>/gs)];
        for (const sm of sMatches) {
          const word = sm[1].replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\n/g, " ").trim();
          if (word) words.push(word);
        }
      }
      transcript = words.join(" ").trim();
    }

    if (transcript.length < 10) {
      return NextResponse.json({ error: "transcript_too_short" }, { status: 404 });
    }

    return NextResponse.json({ transcript });
  } catch (err) {
    console.error("Transcript proxy error:", (err as Error).message);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
