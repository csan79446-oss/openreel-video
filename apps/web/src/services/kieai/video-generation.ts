/**
 * KieAI Video Generation API
 *
 * Supports top video models on Kie.ai:
 * - Runway Gen-3 Alpha ("runway")
 * - Kling 2.6 ("kling-2.6/text-to-video" & "kling-2.6/image-to-video")
 * - Wan 2.6 Video ("wan/2-6-text-to-video")
 * - Google Veo 3.1 Fast ("veo3_fast")
 * - Grok Imagine Video ("grok-imagine/text-to-video" & "grok-imagine/image-to-video")
 *
 * Uses the unified createTask and recordInfo polling endpoint.
 * Docs: https://docs.kie.ai
 */

import { kieaiPostJson, KIEAI_API_BASE_URL } from "./client";
import { pollTask, pollTaskOnce, getResultUrl } from "./image-generation";
import { KieAIError } from "./types";
import type { TaskRecord } from "./image-generation";

export const VIDEO_MODELS = {
  RUNWAY: "runway",
  KLING: "kling-2.6/text-to-video",
  WAN: "wan/2-6-text-to-video",
  VEO: "veo3_fast",
  GROK_VIDEO: "grok-imagine/text-to-video",
} as const;

export type VideoModelId = (typeof VIDEO_MODELS)[keyof typeof VIDEO_MODELS];

export interface VideoModelInfo {
  id: VideoModelId;
  name: string;
  provider: string;
  description: string;
  supportsImageToVideo: boolean;
  supportsSquare: boolean;
}

export const VIDEO_MODEL_INFOS: VideoModelInfo[] = [
  {
    id: VIDEO_MODELS.RUNWAY,
    name: "Runway Gen-3 Alpha",
    provider: "Runway",
    description: "Industry-standard cinematic motion and photorealism",
    supportsImageToVideo: true,
    supportsSquare: false,
  },
  {
    id: VIDEO_MODELS.KLING,
    name: "Kling 2.6",
    provider: "Kuaishou",
    description: "High motion fidelity with native synchronized audio",
    supportsImageToVideo: true,
    supportsSquare: true,
  },
  {
    id: VIDEO_MODELS.WAN,
    name: "Wan 2.6 Video",
    provider: "Alibaba Wan",
    description: "High motion consistency and rich visual detail",
    supportsImageToVideo: true,
    supportsSquare: false,
  },
  {
    id: VIDEO_MODELS.VEO,
    name: "Google Veo 3.1 Fast",
    provider: "Google DeepMind",
    description: "Accelerated generation with high cinematic fidelity",
    supportsImageToVideo: true,
    supportsSquare: false,
  },
  {
    id: VIDEO_MODELS.GROK_VIDEO,
    name: "Grok Imagine Video",
    provider: "xAI",
    description: "Creative visual motion with synchronized dialogue",
    supportsImageToVideo: true,
    supportsSquare: true,
  },
];

export interface VideoGenerationInput {
  prompt: string;
  image_url?: string;
  aspect_ratio?: "16:9" | "9:16" | "1:1";
  duration?: number;
  quality?: "720p" | "1080p";
}

/**
 * Creates an asynchronous video generation task on Kie.ai.
 * Formats model ID and input parameters specifically tailored for each model's schema.
 */
export async function createVideoTask(
  model: VideoModelId,
  input: VideoGenerationInput,
): Promise<string> {
  let targetModel: string = model;
  let targetInput: Record<string, unknown> = {};

  const prompt = input.prompt.trim();
  const imageUrl = input.image_url?.trim();
  const aspectRatio = input.aspect_ratio || "16:9";
  const duration = input.duration === 10 ? 10 : 5;

  if (model === VIDEO_MODELS.RUNWAY) {
    targetModel = "runway";
    // Runway supports 16:9 or 9:16; fallback from 1:1 to 16:9
    const safeAspect = aspectRatio === "9:16" ? "9:16" : "16:9";
    targetInput = {
      prompt,
      aspect_ratio: safeAspect,
      duration,
      quality: "720p",
      watermark: "",
    };
    if (imageUrl) {
      targetInput.image_url = imageUrl;
    }
  } else if (model === VIDEO_MODELS.KLING) {
    if (imageUrl) {
      targetModel = "kling-2.6/image-to-video";
      targetInput = {
        prompt,
        image_url: imageUrl,
      };
    } else {
      targetModel = "kling-2.6/text-to-video";
      targetInput = {
        prompt,
        duration,
        aspect_ratio: aspectRatio,
        sound: true,
      };
    }
  } else if (model === VIDEO_MODELS.WAN) {
    if (imageUrl) {
      targetModel = "wan/2-6-image-to-video";
      targetInput = {
        prompt,
        image_url: imageUrl,
      };
    } else {
      targetModel = "wan/2-6-text-to-video";
      targetInput = {
        prompt,
        duration: String(duration),
        resolution: "720p",
        multi_shots: false,
      };
    }
  } else if (model === VIDEO_MODELS.VEO) {
    if (imageUrl) {
      targetModel = "veo-3-1";
      targetInput = {
        prompt,
        image_urls: [imageUrl],
      };
    } else {
      targetModel = "veo3_fast";
      const safeAspect = aspectRatio === "9:16" ? "9:16" : "16:9";
      targetInput = {
        prompt,
        aspect_ratio: safeAspect,
      };
    }
  } else if (model === VIDEO_MODELS.GROK_VIDEO) {
    if (imageUrl) {
      targetModel = "grok-imagine/image-to-video";
      targetInput = {
        prompt,
        image_urls: [imageUrl],
      };
    } else {
      targetModel = "grok-imagine/text-to-video";
      targetInput = {
        prompt,
        aspect_ratio: aspectRatio,
        mode: "normal",
        duration: "6",
        resolution: "480p",
      };
    }
  } else {
    // Custom model identifier
    targetModel = model;
    targetInput = {
      prompt,
      aspect_ratio: aspectRatio,
      duration,
      quality: "720p",
      ...(imageUrl ? { image_url: imageUrl } : {}),
    };
  }

  const data = await kieaiPostJson<
    object,
    { taskId?: string; task_id?: string } | string
  >(
    "/api/v1/jobs/createTask",
    { model: targetModel, input: targetInput },
    KIEAI_API_BASE_URL,
  );

  const taskId =
    typeof data === "string" ? data : data?.taskId || data?.task_id;
  if (!taskId) {
    throw new KieAIError(500, "No taskId returned from Kie.ai task creation");
  }

  return taskId;
}

export {
  pollTask as pollVideoTask,
  pollTaskOnce as pollVideoTaskOnce,
  getResultUrl as getVideoResultUrl,
};
export type { TaskRecord };
