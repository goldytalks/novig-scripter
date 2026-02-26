import { NextRequest, NextResponse } from "next/server";
import { fetchTranscript, getLastAudioError } from "@/lib/transcript";
import { generateScript, ScriptSettings } from "@/lib/generate-script";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { url, manualTranscript, settings } = body as {
      url: string;
      manualTranscript?: string;
      settings: ScriptSettings;
    };

    if (!url && !manualTranscript) {
      return NextResponse.json(
        { error: "Provide a video URL or paste a transcript" },
        { status: 400 }
      );
    }

    if (!process.env.OPENROUTER_API_KEY) {
      return NextResponse.json(
        { error: "OPENROUTER_API_KEY not configured" },
        { status: 500 }
      );
    }

    const { transcript, meta } = await fetchTranscript(
      url || "",
      manualTranscript
    );

    const result = await generateScript(
      transcript,
      meta.title,
      meta.channel,
      settings
    );

    return NextResponse.json({
      ...result,
      videoTitle: meta.title,
      channel: meta.channel,
      videoId: meta.videoId,
      platform: meta.platform,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "An unexpected error occurred";
    console.error("Generate error:", message);

    const audioError = getLastAudioError();

    const isTranscriptError =
      message.includes("Transcript is disabled") ||
      message.includes("No transcript available") ||
      message.includes("require a manual transcript") ||
      message.includes("Could not transcribe") ||
      message.includes("GOOGLE_AI_KEY");

    return NextResponse.json(
      {
        error: message,
        debug: audioError || undefined,
        ...(isTranscriptError && { code: "TRANSCRIPT_UNAVAILABLE" }),
      },
      { status: isTranscriptError ? 422 : 500 }
    );
  }
}
