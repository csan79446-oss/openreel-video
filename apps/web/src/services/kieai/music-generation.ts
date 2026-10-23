/**
 * KieAI Music Generation API (Suno integration)
 *
 * Provides text-to-music generation using Suno models hosted on Kie.ai.
 * Supports:
 * - Simple mode (text prompt describing mood/genre)
 * - Custom mode (custom lyrics, style tags, song title, and vocal gender: male/female)
 * Docs: https://docs.kie.ai/suno-api/generate-music
 */

import { kieaiPostJson, KIEAI_API_BASE_URL } from "./client";
import { pollTask, pollTaskOnce } from "./image-generation";
import type { TaskRecord } from "./image-generation";
import { KieAIError } from "./types";

export const SUNO_MODELS = [
  { id: "V6", name: "Suno V6", description: "Highest audio fidelity & complex instrumentation" },
  { id: "V6_MINI", name: "Suno V6 Mini", description: "Fastest generation with great fidelity" },
  { id: "V6_WILD", name: "Suno V6 Wild", description: "Bold creative arrangements & experimental styles" },
  { id: "V4", name: "Suno V4", description: "Classic Suno sound engine" },
  { id: "V5_5", name: "Suno V5.5", description: "Versatile, rich vocal expression (Legacy)" },
] as const;

export type SunoModelId = (typeof SUNO_MODELS)[number]["id"];

export type VocalGender = "m" | "f" | "auto";

export interface SunoTrackResult {
  id?: string;
  audioUrl: string;
  streamAudioUrl?: string;
  imageUrl?: string;
  title?: string;
  duration?: number;
  tags?: string;
  prompt?: string;
}

export interface MusicGenerationInput {
  prompt?: string;
  style?: string;
  lyrics?: string;
  title?: string;
  instrumental?: boolean;
  custom_mode?: boolean;
  model?: string;
  vocal_gender?: "m" | "f";
  negative_tags?: string;
  duration?: number;
}

/**
 * Creates a Suno music generation task on Kie.ai.
 * Automatically handles custom mode formatting according to Kie.ai specifications:
 * - When custom_mode is true, title is required (max 80 chars)
 * - Supports custom lyrics (up to 5000 chars) and style (up to 1000 chars)
 * - vocal_gender ("m" | "f") is applied when custom_mode is true and instrumental is false
 */
export async function createMusicTask(input: MusicGenerationInput): Promise<string> {
  const customMode =
    input.custom_mode ??
    Boolean(input.lyrics?.trim() || input.style?.trim() || input.vocal_gender);
  const isInstrumental = input.instrumental ?? false;
  const model = input.model ?? "V6";

  const taskInput: Record<string, unknown> = {
    model,
    instrumental: isInstrumental,
    custom_mode: customMode,
  };

  if (customMode) {
    // In Custom Mode, title is required by Kie.ai (max 80 chars)
    let title = input.title?.trim();
    if (!title) {
      if (input.style?.trim()) {
        title = input.style.trim().split(/[,.\n]/)[0].trim().slice(0, 40);
      } else if (input.lyrics?.trim()) {
        title = input.lyrics.trim().split("\n")[0].replace(/[\[\]]/g, "").trim().slice(0, 40);
      } else if (input.prompt?.trim()) {
        title = input.prompt.trim().split(/[,.\n]/)[0].trim().slice(0, 40);
      }
    }
    taskInput.title = (title || "AI Generated Song").slice(0, 80);

    if (input.style?.trim()) {
      taskInput.style = input.style.trim().slice(0, 1000);
    }
    if (input.lyrics?.trim()) {
      taskInput.lyrics = input.lyrics.trim().slice(0, 5000);
      taskInput.prompt = input.lyrics.trim().slice(0, 5000);
    } else if (input.prompt?.trim()) {
      taskInput.prompt = input.prompt.trim().slice(0, 5000);
    }

    if (!isInstrumental && (input.vocal_gender === "m" || input.vocal_gender === "f")) {
      taskInput.vocal_gender = input.vocal_gender;
    }
    if (input.negative_tags?.trim()) {
      taskInput.negative_tags = input.negative_tags.trim();
    }
    if (input.duration && input.duration >= 10 && input.duration <= 360) {
      taskInput.duration = Math.round(input.duration);
    }
  } else {
    // Non-custom mode (single prompt)
    taskInput.prompt = (input.prompt?.trim() || input.style?.trim() || "").slice(0, 3000);
    if (input.lyrics?.trim()) {
      taskInput.lyrics = input.lyrics.trim();
    }
  }

  const data = await kieaiPostJson<object, any>(
    "/api/v1/jobs/createTask",
    {
      model: "ai-music-api/generate",
      input: taskInput,
    },
    KIEAI_API_BASE_URL,
  );

  const taskId =
    typeof data === "string"
      ? data
      : data?.taskId || data?.task_id || data?.data?.taskId || data?.data?.task_id;

  if (!taskId) {
    throw new KieAIError(500, "No taskId returned from Kie.ai task creation");
  }

  return taskId;
}

/**
 * Extract all generated Suno tracks from a completed TaskRecord.
 * Handles all Kie.ai variations: sunoData, response.sunoData, data.sunoData, resultUrls, etc.
 */
export function getMusicTracks(record: TaskRecord): SunoTrackResult[] {
  if (!record) {
    throw new KieAIError(500, "Empty task record received");
  }

  let rj: Record<string, unknown> | null = null;
  if (typeof record.resultJson === "string") {
    const trimmed = record.resultJson.trim();
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      return [{ audioUrl: trimmed, title: "Generated Track 1" }];
    }
    try {
      rj = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      console.warn("[KieAI Suno] Could not parse resultJson as JSON string:", trimmed);
    }
  } else if (typeof record.resultJson === "object" && record.resultJson !== null) {
    rj = record.resultJson as Record<string, unknown>;
  }

  const recAny = record as unknown as Record<string, unknown>;

  // Check known Suno track arrays
  const candidateArrays: unknown[] = [
    rj?.sunoData,
    (rj?.response as Record<string, unknown> | undefined)?.sunoData,
    (rj?.data as Record<string, unknown> | undefined)?.sunoData,
    (rj?.data as any)?.response?.sunoData,
    (rj?.result as Record<string, unknown> | undefined)?.sunoData,
    recAny.sunoData,
    (recAny.response as Record<string, unknown> | undefined)?.sunoData,
    (recAny.data as Record<string, unknown> | undefined)?.sunoData,
    rj?.tracks,
    rj?.audios,
    rj?.audio_urls,
    rj?.resultUrls,
    rj?.result_urls,
    rj?.outputs,
    rj?.urls,
    recAny.resultUrls,
    recAny.result_urls,
  ];

  const tracks: SunoTrackResult[] = [];

  for (const arr of candidateArrays) {
    if (Array.isArray(arr) && arr.length > 0) {
      for (let i = 0; i < arr.length; i++) {
        const item = arr[i];
        if (typeof item === "string" && (item.startsWith("http://") || item.startsWith("https://"))) {
          tracks.push({ audioUrl: item, title: `Track ${tracks.length + 1}` });
        } else if (item && typeof item === "object") {
          const obj = item as Record<string, unknown>;
          const audioUrl =
            (typeof obj.audio_url === "string" && obj.audio_url) ||
            (typeof obj.audioUrl === "string" && obj.audioUrl) ||
            (typeof obj.stream_audio_url === "string" && obj.stream_audio_url) ||
            (typeof obj.streamAudioUrl === "string" && obj.streamAudioUrl) ||
            (typeof obj.url === "string" && obj.url) ||
            (typeof obj.audio === "string" && obj.audio) ||
            (typeof obj.music_url === "string" && obj.music_url) ||
            (typeof obj.resultUrl === "string" && obj.resultUrl) ||
            (typeof obj.src === "string" && obj.src);

          if (audioUrl) {
            const streamUrl =
              (typeof obj.stream_audio_url === "string" && obj.stream_audio_url) ||
              (typeof obj.streamAudioUrl === "string" && obj.streamAudioUrl) ||
              undefined;
            const imageUrl =
              (typeof obj.image_url === "string" && obj.image_url) ||
              (typeof obj.imageUrl === "string" && obj.imageUrl) ||
              (typeof obj.cover === "string" && obj.cover) ||
              undefined;
            const title =
              (typeof obj.title === "string" && obj.title) ||
              (typeof obj.name === "string" && obj.name) ||
              `Track ${tracks.length + 1}`;
            const duration =
              typeof obj.duration === "number"
                ? obj.duration
                : typeof obj.duration === "string"
                ? parseFloat(obj.duration) || undefined
                : undefined;
            const id =
              (typeof obj.id === "string" && obj.id) ||
              (typeof obj.audio_id === "string" && obj.audio_id) ||
              undefined;
            const tags = (typeof obj.tags === "string" && obj.tags) || undefined;
            const prompt = (typeof obj.prompt === "string" && obj.prompt) || undefined;

            tracks.push({
              id,
              audioUrl,
              streamAudioUrl: streamUrl,
              imageUrl,
              title,
              duration,
              tags,
              prompt,
            });
          }
        }
      }
      if (tracks.length > 0) return tracks;
    }
  }

  // Check single URL fields
  const singleFields = [
    "audio_url",
    "audioUrl",
    "stream_audio_url",
    "streamAudioUrl",
    "resultUrl",
    "result_url",
    "url",
    "audio",
    "music_url",
    "output",
  ];
  for (const field of singleFields) {
    const val = rj?.[field] ?? recAny[field];
    if (typeof val === "string" && (val.startsWith("http://") || val.startsWith("https://"))) {
      return [{ audioUrl: val, title: "Generated Track 1" }];
    }
  }

  // Recursive fallback: any audio file or url
  const collectedUrls: string[] = [];
  function collectUrls(val: unknown) {
    if (!val) return;
    if (typeof val === "string") {
      if (val.startsWith("http://") || val.startsWith("https://")) {
        collectedUrls.push(val);
      }
    } else if (Array.isArray(val)) {
      for (const child of val) collectUrls(child);
    } else if (typeof val === "object") {
      for (const k of Object.keys(val as Record<string, unknown>)) {
        collectUrls((val as Record<string, unknown>)[k]);
      }
    }
  }
  collectUrls(rj || record);

  const audioRegex = /\.(mp3|wav|m4a|ogg|aac|flac)(\?.*)?$/i;
  const audioSpecific = collectedUrls.filter(
    (u) => audioRegex.test(u) || u.includes("audio") || u.includes("suno") || u.includes("music"),
  );

  if (audioSpecific.length > 0) {
    return audioSpecific.map((url, i) => ({
      audioUrl: url,
      title: `Generated Track ${i + 1}`,
    }));
  }

  if (collectedUrls.length > 0) {
    return [{ audioUrl: collectedUrls[0], title: "Generated Track 1" }];
  }

  console.error("[KieAI Suno] Unable to find audio URL in completed record:", record);
  throw new KieAIError(500, "No audio URL found in Suno response — check raw response in console");
}

/**
 * Extract the primary audio URL from a completed Suno task record.
 */
export function getMusicResultUrl(record: TaskRecord): string {
  const tracks = getMusicTracks(record);
  if (tracks.length === 0 || !tracks[0].audioUrl) {
    throw new KieAIError(500, "No audio track found in completed Suno task");
  }
  return tracks[0].audioUrl;
}

export { pollTask as pollMusicTask, pollTaskOnce as pollMusicTaskOnce };
export type { TaskRecord };
