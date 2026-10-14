import { useCallback } from "react";
import { isSessionUnlocked, getSecret } from "../../../../services/secure-storage";
import { apiFetch } from "../../../../services/api-proxy";

export interface GeminiVoice {
  id: string;
  name: string;
  gender: "female" | "male";
  description: string;
}

export const GEMINI_VOICES: readonly GeminiVoice[] = [
  {
    id: "Aoede",
    name: "Aoede",
    gender: "female",
    description: "Warm, expressive and natural female voice",
  },
  {
    id: "Charon",
    name: "Charon",
    gender: "male",
    description: "Deep, calm and informative male voice",
  },
  {
    id: "Fenrir",
    name: "Fenrir",
    gender: "male",
    description: "Commanding, authoritative and clear male voice",
  },
  {
    id: "Kore",
    name: "Kore",
    gender: "female",
    description: "Soothing, gentle and friendly female voice",
  },
  {
    id: "Puck",
    name: "Puck",
    gender: "male",
    description: "Upbeat, lively and engaging voice",
  },
] as const;

function createWavHeader(
  dataLength: number,
  sampleRate: number = 24000,
  numChannels: number = 1,
  bitsPerSample: number = 16,
): Uint8Array {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  // "RIFF" chunk descriptor
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + dataLength, true); // ChunkSize
  view.setUint32(8, 0x57415645, false); // "WAVE"

  // "fmt " sub-chunk
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
  view.setUint16(22, numChannels, true); // NumChannels
  view.setUint32(24, sampleRate, true); // SampleRate
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  view.setUint32(28, byteRate, true); // ByteRate
  const blockAlign = (numChannels * bitsPerSample) / 8;
  view.setUint16(32, blockAlign, true); // BlockAlign
  view.setUint16(34, bitsPerSample, true); // BitsPerSample

  // "data" sub-chunk
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataLength, true); // Subchunk2Size

  return new Uint8Array(header);
}

function base64ToAudioBlob(base64Data: string, mimeType: string = "audio/wav"): Blob {
  const binaryString = atob(base64Data);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // If already contains RIFF header (standard WAV) or MP3/OGG container
  const isRiff =
    bytes.length > 4 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46;

  if (isRiff || mimeType.includes("mp3") || mimeType.includes("mpeg") || mimeType.includes("ogg")) {
    return new Blob([bytes], { type: mimeType || "audio/wav" });
  }

  // Prepend standard WAV header (Gemini 2.0 returns 24kHz 16-bit mono PCM by default)
  const sampleRate = mimeType.includes("rate=")
    ? parseInt(mimeType.split("rate=")[1], 10) || 24000
    : 24000;
  const wavHeader = createWavHeader(bytes.length, sampleRate, 1, 16);
  const wavBytes = new Uint8Array(wavHeader.length + bytes.length);
  wavBytes.set(wavHeader, 0);
  wavBytes.set(bytes, wavHeader.length);

  return new Blob([wavBytes], { type: "audio/wav" });
}

function extractAudioData(result: Record<string, unknown>): { base64?: string; mimeType: string } {
  let audioBase64: string | undefined;
  let mimeType = "audio/wav";

  const candidates = (result.candidates as Array<Record<string, unknown>>) ?? [];
  for (const candidate of candidates) {
    const parts = (candidate?.content as Record<string, unknown>)?.parts as
      | Array<Record<string, unknown>>
      | undefined;
    for (const p of parts ?? []) {
      const inline = (p?.inlineData ?? p?.inline_data ?? p?.audioData ?? p?.audio_data) as
        | Record<string, unknown>
        | undefined;
      if (inline?.data && typeof inline.data === "string") {
        audioBase64 = inline.data;
        mimeType = ((inline.mimeType || inline.mime_type || mimeType) as string);
        return { base64: audioBase64, mimeType };
      }
    }
  }

  if (result.audioContent && typeof result.audioContent === "string") {
    return { base64: result.audioContent, mimeType: "audio/mp3" };
  }
  if (result.audio_content && typeof result.audio_content === "string") {
    return { base64: result.audio_content, mimeType: "audio/mp3" };
  }

  return { base64: undefined, mimeType };
}

function extractTextTranscript(result: Record<string, unknown>): string {
  let text = "";
  const candidates = (result.candidates as Array<Record<string, unknown>>) ?? [];
  for (const candidate of candidates) {
    const parts = (candidate?.content as Record<string, unknown>)?.parts as
      | Array<Record<string, unknown>>
      | undefined;
    for (const p of parts ?? []) {
      if (typeof p?.text === "string") {
        text += p.text + " ";
      }
    }
  }
  return text.trim();
}

function splitTextIntoTtsChunks(text: string, maxLen = 160): string[] {
  const clean = text.trim();
  if (!clean) return [];
  if (clean.length <= maxLen) return [clean];

  // Split on Khmer Khan (។), full stops, exclamation marks, question marks, newlines
  const sentences = clean.split(/([។.!?\n]+)/);
  const chunks: string[] = [];
  let current = "";

  for (let i = 0; i < sentences.length; i++) {
    const part = sentences[i];
    if (!part) continue;
    if ((current + part).length <= maxLen) {
      current += part;
    } else {
      if (current.trim()) chunks.push(current.trim());
      if (part.length <= maxLen) {
        current = part;
      } else {
        const words = part.split(/\s+/);
        current = "";
        for (const w of words) {
          if ((current + " " + w).length <= maxLen) {
            current = current ? current + " " + w : w;
          } else {
            if (current.trim()) chunks.push(current.trim());
            let remaining = w;
            while (remaining.length > maxLen) {
              chunks.push(remaining.slice(0, maxLen));
              remaining = remaining.slice(maxLen);
            }
            current = remaining;
          }
        }
      }
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [clean.slice(0, maxLen)];
}

async function synthesizeFallbackTts(text: string, signal?: AbortSignal): Promise<Blob> {
  const isKhmer = /[\u1780-\u17FF]/.test(text);
  const lang = isKhmer ? "km" : "en";
  const chunks = splitTextIntoTtsChunks(text, 160);
  const isDesktop = typeof window !== "undefined" && window.openreel?.platform === "desktop";
  const prefix = isDesktop ? "https://translate.google.com" : "/proxy/google-tts";

  const buffers: ArrayBuffer[] = [];
  for (const chunk of chunks) {
    if (!chunk.trim()) continue;
    const url = `${prefix}/translate_tts?ie=UTF-8&tl=${lang}&client=tw-ob&q=${encodeURIComponent(chunk)}`;
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal,
    });
    if (!resp.ok) {
      throw new Error(`TTS synthesis fallback failed (${resp.status})`);
    }
    const buf = await resp.arrayBuffer();
    buffers.push(buf);
  }

  if (buffers.length === 0) {
    throw new Error("No audio content generated.");
  }

  const totalLength = buffers.reduce((acc, b) => acc + b.byteLength, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const b of buffers) {
    combined.set(new Uint8Array(b), offset);
    offset += b.byteLength;
  }

  return new Blob([combined], { type: "audio/mpeg" });
}

export function useGeminiTtsApi() {
  const isDesktop = typeof window !== "undefined" && window.openreel?.platform === "desktop";

  const generateWithGemini = useCallback(
    async (inputText: string, voiceName: string, signal?: AbortSignal): Promise<Blob> => {
      if (!isSessionUnlocked()) {
        throw new Error("Session locked. Unlock in Settings > API Keys first.");
      }

      const apiKey = isDesktop ? "" : (await getSecret("gemini")) ?? "";
      if (!isDesktop && !apiKey) {
        throw new Error("Google Gemini API key not found. Add it in Settings > API Keys.");
      }

      const textToSpeak = inputText.trim();
      if (!textToSpeak) {
        throw new Error("Please enter text to generate speech.");
      }

      const requestBody = {
        contents: [
          {
            parts: [{ text: textToSpeak }],
          },
        ],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: voiceName || "Aoede",
              },
            },
          },
        },
      };

      const candidateModels = [
        "gemini-3.8-flash-tts",
        "gemini-3.8-flash-lite-tts",
        "gemini-2.5-flash-preview-tts",
        "gemini-2.0-flash",
        "gemini-2.0-flash-exp",
      ];
      let lastError: Error | null = null;
      let textTranscript = "";

      for (const model of candidateModels) {
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
            const errObj = (errorData as Record<string, unknown>).error as Record<string, unknown> | undefined;
            const msg = errObj?.message ?? (errorData as Record<string, unknown>).message ?? `Gemini error (${response.status})`;
            lastError = new Error(String(msg));
            console.warn(`Gemini TTS model ${model} failed (${response.status}): ${msg}`);
            continue;
          }

          const result = (await response.json()) as Record<string, unknown>;
          const { base64: audioBase64, mimeType } = extractAudioData(result);

          if (audioBase64) {
            return base64ToAudioBlob(audioBase64, mimeType);
          }

          const capturedText = extractTextTranscript(result);
          if (capturedText) {
            textTranscript = capturedText;
          }
          console.warn(`Gemini model ${model} returned text instead of audio, checking next candidate...`);
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") throw err;
          lastError = err instanceof Error ? err : new Error(String(err));
          console.warn(`Error trying Gemini TTS model ${model}:`, lastError.message);
        }
      }

      // Check Google Cloud Text-To-Speech synthesize endpoint
      if (apiKey) {
        try {
          const isKhmer = /[\u1780-\u17FF]/.test(textToSpeak);
          const ttsResp = await fetch(
            `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                input: { text: textToSpeak },
                voice: {
                  languageCode: isKhmer ? "km-KH" : "en-US",
                  name: isKhmer
                    ? "km-KH-Standard-A"
                    : voiceName === "Charon" || voiceName === "Fenrir"
                      ? "en-US-Standard-B"
                      : "en-US-Standard-C",
                },
                audioConfig: { audioEncoding: "MP3" },
              }),
              signal,
            },
          );
          if (ttsResp.ok) {
            const ttsData = await ttsResp.json();
            if (ttsData.audioContent) {
              return base64ToAudioBlob(ttsData.audioContent, "audio/mp3");
            }
          }
        } catch {
          // Ignore and continue to fallback
        }
      }

      // Seamless fallback via Google Speech synthesis (supports Khmer & English without fail)
      try {
        return await synthesizeFallbackTts(textToSpeak, signal);
      } catch (fallbackErr) {
        console.warn("Fallback TTS also failed:", fallbackErr);
      }

      if (textTranscript) {
        throw new Error(
          `Gemini returned text instead of audio: "${textTranscript.slice(0, 100)}..."`,
        );
      }

      throw lastError ?? new Error("Gemini speech generation failed. Please check your API key.");
    },
    [isDesktop],
  );

  return {
    geminiVoices: GEMINI_VOICES,
    generateWithGemini,
  };
}
