/**
 * KieAI Image Generation API
 *
 * Supports 6 image models. All use the same createTask endpoint and the same
 * polling endpoint. Each model has its own typed input shape.
 *
 * Flow:
 *   1. Upload source image via uploadFileStream → get fileUrl
 *   2. createTask(model, input) → taskId
 *   3. pollTask(taskId) → result image URL
 *
 * Docs: https://docs.kie.ai/market/common/get-task-detail
 */

import { kieaiPostJson, kieaiGet, KIEAI_API_BASE_URL } from "./client";
import { KieAIError } from "./types";

// ─── Model identifiers ────────────────────────────────────────────────────────

export const IMAGE_MODELS = {
  SEEDREAM:     "seedream/5-lite-image-to-image",
  Z_IMAGE:      "z-image",
  NANO_BANANA2: "nano-banana-2",
  FLUX2:        "flux-2/pro-image-to-image",
  GROK:         "grok-imagine/image-to-image",
  QWEN:         "qwen/image-to-image",
} as const;

export type ImageModelId = typeof IMAGE_MODELS[keyof typeof IMAGE_MODELS];

// ─── Per-model input types ────────────────────────────────────────────────────

export type AspectRatio =
  | "1:1" | "4:3" | "3:4" | "16:9" | "9:16"
  | "2:3" | "3:2" | "21:9" | "auto";

export interface SeedreamInput {
  prompt: string;
  /** Uploaded image URLs (max 14). Use uploadFileStream first. */
  image_urls: string[];
  aspect_ratio: AspectRatio;
  /** basic = 2K, high = 4K */
  quality: "basic" | "high";
}

export interface ZImageInput {
  prompt: string;
  /** Z-Image is text-to-image — no image_url field */
  aspect_ratio: "1:1" | "4:3" | "3:4" | "16:9" | "9:16";
}

export interface NanoBanana2Input {
  prompt: string;
  /** Optional reference images (max 14) */
  image_input?: string[];
  aspect_ratio?: AspectRatio | "1:4" | "1:8" | "4:1" | "4:5" | "5:4" | "8:1";
  resolution?: "1K" | "2K" | "4K";
  output_format?: "png" | "jpg";
}

export interface Flux2Input {
  /** Reference images (1–8). Use uploadFileStream first. */
  input_urls: string[];
  prompt: string;
  aspect_ratio: AspectRatio;
  resolution: "1K" | "2K";
}

export interface GrokInput {
  /** Single reference image URL. Use uploadFileStream first. */
  image_urls: string[];
  prompt?: string;
}

export interface QwenInput {
  prompt: string;
  /** Single reference image URL. Use uploadFileStream first. */
  image_url: string;
  /** 0 = preserve original, 1 = full remake. Default 0.8 */
  strength?: number;
  output_format?: "png" | "jpeg";
  acceleration?: "none" | "regular" | "high";
  negative_prompt?: string;
  seed?: number;
  /** 2–250. Default 30 */
  num_inference_steps?: number;
  /** 0–20. Default 2.5 */
  guidance_scale?: number;
  enable_safety_checker?: boolean;
}

export type ImageModelInput =
  | SeedreamInput
  | ZImageInput
  | NanoBanana2Input
  | Flux2Input
  | GrokInput
  | QwenInput;

// ─── Task lifecycle ───────────────────────────────────────────────────────────

export type TaskState = "waiting" | "queuing" | "generating" | "success" | "fail";

export interface TaskRecord {
  taskId: string;
  model: string;
  state: TaskState;
  /** API returns this as a JSON string — getResultUrl handles parsing */
  resultJson: string | { resultUrls?: string[]; resultObject?: unknown } | null;
  failCode?: number;
  failMsg?: string;
  costTime?: number;
  completeTime?: string;
  createTime: string;
  updateTime: string;
  progress?: number;
}

// ─── Create task ──────────────────────────────────────────────────────────────

export async function createImageTask(
  model: ImageModelId,
  input: ImageModelInput,
): Promise<string> {
  const data = await kieaiPostJson<object, { taskId: string }>(
    "/api/v1/jobs/createTask",
    { model, input },
    KIEAI_API_BASE_URL,
  );
  return data.taskId;
}

// ─── Poll task ────────────────────────────────────────────────────────────────

const POLL_INTERVALS = [2000, 2000, 3000, 3000, 5000]; // ms, last value repeats

/**
 * Poll the task until it reaches `success` or `fail`.
 * Calls `onProgress` with the latest record on each poll.
 *
 * @param signal  - AbortSignal to cancel polling
 */
export async function pollTask(
  taskId: string,
  onProgress?: (record: TaskRecord) => void,
  signal?: AbortSignal,
): Promise<TaskRecord> {
  let attempt = 0;

  while (!signal?.aborted) {
    const record = await kieaiGet<TaskRecord>(
      "/api/v1/jobs/recordInfo",
      { taskId },
      KIEAI_API_BASE_URL,
    );

    onProgress?.(record);

    if (record.state === "success") return record;
    if (record.state === "fail") {
      const rec = record as any;
      const msg = rec.failMsg || rec.failReason || rec.error || rec.message || "Generation failed";
      throw new KieAIError(record.failCode ?? 500, msg);
    }

    // Wait before next poll
    const delay = POLL_INTERVALS[Math.min(attempt, POLL_INTERVALS.length - 1)];
    attempt++;
    await new Promise<void>((res, rej) => {
      const t = setTimeout(res, delay);
      signal?.addEventListener("abort", () => { clearTimeout(t); rej(new DOMException("Aborted", "AbortError")); }, { once: true });
    });
  }

  throw new DOMException("Polling cancelled", "AbortError");
}

/**
 * Single poll — returns the latest TaskRecord without looping.
 * Use this in background polling hooks that manage their own interval.
 */
export async function pollTaskOnce(taskId: string): Promise<TaskRecord> {
  return kieaiGet<TaskRecord>(
    "/api/v1/jobs/recordInfo",
    { taskId },
    KIEAI_API_BASE_URL,
  );
}

/**
 * Extract the first result media URL (image or video) from a completed task.
 *
 * KieAI's resultJson shape varies by model — we try all known field paths.
 */
export function getResultUrl(record: TaskRecord): string {
  if (!record) {
    throw new KieAIError(500, "Empty task record received");
  }

  // resultJson is returned as a JSON string by the API — parse it if needed
  let rj: Record<string, unknown> | null = null;
  if (typeof record.resultJson === "string") {
    const trimmed = record.resultJson.trim();
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      return trimmed;
    }
    try {
      rj = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      throw new KieAIError(500, "Failed to parse resultJson from API");
    }
  } else if (typeof record.resultJson === "object" && record.resultJson !== null) {
    rj = record.resultJson as Record<string, unknown>;
  }

  const recAny = record as unknown as Record<string, unknown>;

  // Try every known array field path
  const candidateArrays: unknown[] = [
    rj?.resultUrls,
    rj?.result_urls,
    rj?.sunoData,
    (rj?.response as Record<string, unknown> | undefined)?.sunoData,
    (rj?.data as Record<string, unknown> | undefined)?.sunoData,
    rj?.videos,
    rj?.video_urls,
    rj?.images,
    rj?.outputs,
    rj?.urls,
    rj?.audios,
    rj?.tracks,
    recAny.resultUrls,
    recAny.result_urls,
    recAny.sunoData,
    (recAny.response as Record<string, unknown> | undefined)?.sunoData,
    recAny.videos,
    recAny.video_urls,
  ];

  for (const candidate of candidateArrays) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      const first = candidate[0];
      if (typeof first === "string" && first) return first;
      if (first && typeof first === "object") {
        const obj = first as Record<string, unknown>;
        for (const field of [
          "audio_url",
          "audioUrl",
          "stream_audio_url",
          "streamAudioUrl",
          "url",
          "video_url",
          "videoUrl",
          "video",
          "image_url",
          "imageUrl",
          "resultUrl",
          "audio",
          "music_url",
        ]) {
          if (typeof obj[field] === "string" && obj[field]) return obj[field] as string;
        }
      }
    }
  }

  // Single-string fields
  const stringFields = [
    "audio_url",
    "audioUrl",
    "stream_audio_url",
    "streamAudioUrl",
    "resultUrl",
    "result_url",
    "url",
    "audio",
    "music_url",
    "video_url",
    "videoUrl",
    "video",
    "image_url",
    "output",
    "imageUrl",
  ];
  for (const field of stringFields) {
    const val = rj?.[field] ?? recAny[field];
    if (typeof val === "string" && val && (val.startsWith("http://") || val.startsWith("https://"))) {
      return val;
    }
  }

  // Nested: resultJson.result.url or resultJson.data.url or resultJson.video.url or resultJson.response.url
  for (const wrapper of ["result", "data", "output", "video", "response", "sunoData"]) {
    const nested = (rj?.[wrapper] ?? recAny[wrapper]) as Record<string, unknown> | undefined;
    if (nested && typeof nested === "object") {
      for (const field of [
        "audio_url",
        "audioUrl",
        "stream_audio_url",
        "streamAudioUrl",
        "url",
        "video_url",
        "videoUrl",
        "video",
        "image_url",
        "imageUrl",
        "resultUrl",
        "audio",
      ]) {
        if (typeof nested[field] === "string" && nested[field]) return nested[field] as string;
      }
      if (Array.isArray(nested.urls) && typeof nested.urls[0] === "string") return nested.urls[0];
      if (Array.isArray(nested.resultUrls) && typeof nested.resultUrls[0] === "string") return nested.resultUrls[0];
      if (Array.isArray(nested.videos) && typeof nested.videos[0] === "string") return nested.videos[0];
      if (Array.isArray(nested.video_urls) && typeof nested.video_urls[0] === "string") return nested.video_urls[0];
      if (Array.isArray(nested.sunoData) && nested.sunoData.length > 0) {
        const item = nested.sunoData[0] as any;
        const u = item?.audio_url || item?.audioUrl || item?.stream_audio_url || item?.url;
        if (typeof u === "string" && u) return u;
      }
    }
  }

  // Recursive fallback: any http/https URL
  const allUrls: string[] = [];
  function harvestUrls(node: unknown) {
    if (!node) return;
    if (typeof node === "string") {
      if (node.startsWith("http://") || node.startsWith("https://")) allUrls.push(node);
    } else if (Array.isArray(node)) {
      for (const item of node) harvestUrls(item);
    } else if (typeof node === "object") {
      for (const k of Object.keys(node as Record<string, unknown>)) {
        harvestUrls((node as Record<string, unknown>)[k]);
      }
    }
  }
  harvestUrls(rj || record);

  const mediaUrls = allUrls.filter((u) =>
    /\.(mp3|wav|m4a|ogg|mp4|mov|webm|png|jpg|jpeg|webp)(\?.*)?$/i.test(u) ||
    u.includes("audio") || u.includes("video") || u.includes("suno")
  );
  if (mediaUrls.length > 0) return mediaUrls[0];
  if (allUrls.length > 0) return allUrls[0];

  console.error("[KieAI] Unable to find media URL in completed record:", record);
  throw new KieAIError(500, "No result URL in completed task — check console for raw record");
}
