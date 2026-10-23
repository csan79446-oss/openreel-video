/**
 * KieAI service — public API
 *
 * Usage:
 *   import { uploadFile, uploadFileStream, KieAIError } from "@/services/kieai";
 *
 * Requires the KieAI API key to be stored in secure-storage under the id
 * "kieai-api-key" and the session to be unlocked.
 */

export { KIEAI_BASE_URL, KIEAI_SECRET_ID } from "./client";

export type {
  KieAIResponse,
  UploadedFile,
  FileUploadResponse,
  UploadOptions,
  UrlUploadOptions,
  Base64UploadOptions,
} from "./types";

export { KieAIError } from "./types";

export {
  uploadFile,
  uploadFileByUrl,
  uploadFileStream,
  uploadFileBase64,
} from "./file-upload";

export {
  IMAGE_MODELS,
  createImageTask,
  pollTask,
  pollTaskOnce,
  getResultUrl,
} from "./image-generation";

export type {
  AspectRatio,
  ImageModelId,
  ImageModelInput,
  SeedreamInput,
  ZImageInput,
  NanoBanana2Input,
  Flux2Input,
  GrokInput,
  QwenInput,
  TaskRecord,
  TaskState,
} from "./image-generation";

export {
  VIDEO_MODELS,
  VIDEO_MODEL_INFOS,
  createVideoTask,
  pollVideoTask,
  pollVideoTaskOnce,
  getVideoResultUrl,
} from "./video-generation";

export type {
  VideoModelId,
  VideoModelInfo,
  VideoGenerationInput,
} from "./video-generation";

export {
  SUNO_MODELS,
  createMusicTask,
  pollMusicTask,
  pollMusicTaskOnce,
  getMusicResultUrl,
  getMusicTracks,
} from "./music-generation";

export type {
  SunoModelId,
  VocalGender,
  SunoTrackResult,
  MusicGenerationInput,
} from "./music-generation";

