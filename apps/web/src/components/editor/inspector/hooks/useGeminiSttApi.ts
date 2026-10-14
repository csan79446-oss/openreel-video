import { useCallback } from "react";
import { isSessionUnlocked, getSecret } from "../../../../services/secure-storage";
import { apiFetch } from "../../../../services/api-proxy";
import { useSettingsStore } from "../../../../stores/settings-store";

export interface GeminiTranscriptionSegment {
  startTime: number;
  endTime: number;
  text: string;
}

function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Converts Float32Array mono audio samples (e.g. 16kHz) to a 16-bit PCM WAV base64 string.
 */
export function float32ToWavBase64(samples: Float32Array, sampleRate = 16000): string {
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF chunk descriptor
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");

  // fmt sub-chunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
  view.setUint16(22, numChannels, true); // NumChannels
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, byteRate, true); // ByteRate
  view.setUint16(32, blockAlign, true); // BlockAlign
  view.setUint16(34, bitsPerSample, true); // BitsPerSample

  // data sub-chunk
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  // Write PCM audio data
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  // Convert ArrayBuffer to Base64 in safe chunks
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + chunkSize) as unknown as number[],
    );
  }
  return btoa(binary);
}

function cleanJsonString(str: string): string {
  let cleaned = str.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.replace(/^```json\s*/i, "").replace(/\s*```$/, "");
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```\s*/, "").replace(/\s*```$/, "");
  }
  return cleaned.trim();
}

const CANDIDATE_GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
  "gemini-3.8-flash",
] as const;

export function useGeminiSttApi() {
  const configuredServices = useSettingsStore((state) => state.configuredServices);
  const openSettings = useSettingsStore((state) => state.openSettings);
  const isDesktop = typeof window !== "undefined" && window.openreel?.platform === "desktop";
  const hasGeminiKey = isDesktop || configuredServices.includes("gemini");

  const transcribeWithGemini = useCallback(
    async (
      samples: Float32Array,
      languageCode: string = "km",
      signal?: AbortSignal,
    ): Promise<GeminiTranscriptionSegment[]> => {
      if (!isDesktop && !isSessionUnlocked()) {
        throw new Error("Session locked. Unlock in Settings > API Keys first.");
      }

      const apiKey = isDesktop ? "" : (await getSecret("gemini")) ?? "";
      if (!isDesktop && !apiKey) {
        throw new Error(
          "Google Gemini API key not found. Please add your key in Settings > API Keys.",
        );
      }

      if (samples.length === 0) {
        throw new Error("No audio samples provided for transcription.");
      }

      const wavBase64 = float32ToWavBase64(samples, 16000);

      const isKhmer = languageCode === "km" || languageCode.toLowerCase().includes("khmer");
      const languageInstruction = isKhmer
        ? `Target Language: Khmer (ភាសាខ្មែរ).
CRITICAL RULES FOR KHMER:
1. Output MUST be authentic Khmer Unicode script (អក្សរខ្មែរ ដូចជា៖ ខ្ញុំ, គាត់, ទៅ, ធ្វើ, etc.).
2. NEVER output phonetic, romanized or Latin transliteration (e.g., do NOT output "hau rong...", "kort nam...").
3. Ensure correct Khmer grammar, spelling, and natural phrasing.`
        : `Target Language: ${languageCode}. Ensure accurate native spelling and phrasing.`;

      const prompt = `You are a high-precision subtitle and speech-to-text engine for video editing.
Transcribe the speech in this audio recording into clean, concise subtitle cues with start and end timestamps.

${languageInstruction}

SUBTITLE REQUIREMENTS:
1. Provide accurate start and end timestamps in seconds (e.g. 0.0, 2.5) relative to the start of this audio clip (where audio begins at 0.0s).
2. Segment the dialogue into short, easy-to-read subtitle lines (roughly 3 to 7 words, or 1.5 to 4 seconds per cue).
3. Do not omit any spoken words.
4. Output MUST be a valid JSON array of cue objects with exact keys: "startTime" (number), "endTime" (number), "text" (string).

Example JSON output:
[
  { "startTime": 0.0, "endTime": 2.4, "text": "សូមស្វាគមន៍មកកាន់ការបង្ហាញ" },
  { "startTime": 2.5, "endTime": 4.8, "text": "ថ្ងៃនេះយើងនឹងពិភាក្សាអំពី..." }
]

Output ONLY the JSON array. Do not output conversational explanations or markdown blocks.`;

      const requestBody = {
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: "audio/wav",
                  data: wavBase64,
                },
              },
              {
                text: prompt,
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.1,
        },
      };

      let lastError: Error | null = null;

      for (const model of CANDIDATE_GEMINI_MODELS) {
        try {
          const response = await apiFetch(
            "gemini",
            `/models/${model}:generateContent`,
            apiKey,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(requestBody),
              signal,
            },
          );

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const errObj = (errorData as Record<string, unknown>).error as
              | Record<string, unknown>
              | undefined;
            const msg =
              errObj?.message ??
              (errorData as Record<string, unknown>).message ??
              `Gemini error (${response.status})`;
            lastError = new Error(String(msg));
            console.warn(`Gemini STT model ${model} failed (${response.status}): ${msg}`);
            continue;
          }

          const result = (await response.json()) as Record<string, unknown>;
          const candidates = result.candidates as Array<Record<string, unknown>> | undefined;
          const candidate = candidates?.[0];
          const content = candidate?.content as Record<string, unknown> | undefined;
          const parts = content?.parts as Array<Record<string, unknown>> | undefined;
          const rawText = String(parts?.[0]?.text ?? "").trim();

          if (!rawText) {
            throw new Error("Gemini returned an empty transcription response.");
          }

          const cleanedJson = cleanJsonString(rawText);
          const parsed = JSON.parse(cleanedJson);

          if (!Array.isArray(parsed)) {
            throw new Error("Invalid transcription format returned by Gemini.");
          }

          const segments: GeminiTranscriptionSegment[] = parsed
            .map((item: Record<string, unknown>) => ({
              startTime: Number(item.startTime ?? item.start ?? 0),
              endTime: Number(item.endTime ?? item.end ?? 0),
              text: String(item.text ?? item.caption ?? "").trim(),
            }))
            .filter(
              (item) => item.text.length > 0 && item.endTime > item.startTime,
            );

          return segments;
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") throw err;
          lastError = err instanceof Error ? err : new Error(String(err));
          console.warn(`Gemini STT model ${model} error:`, err);
        }
      }

      throw (
        lastError ??
        new Error("Gemini transcription failed. Please verify your Gemini API key and try again.")
      );
    },
    [isDesktop],
  );

  return {
    transcribeWithGemini,
    hasGeminiKey,
    openSettings,
  };
}
