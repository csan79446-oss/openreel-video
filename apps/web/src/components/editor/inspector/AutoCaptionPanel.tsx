import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SUBTITLE_STYLE_PRESETS,
  splitCaptionIntoSingleLineCues,
  type TranscriptionSegment,
} from "@openreel/core";
import {
  ToolcraftButton as Button,
  ToolcraftCard as Card,
  ToolcraftSelectControl as Selector,
  ToolcraftText as Text,
} from "@openreel/ui";
import {
  AlertCircle,
  Check,
  Download,
  Languages,
  Loader2,
  Sparkles,
} from "@/icons/lucide-compat";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { loadAudioBuffer } from "../../../utils/load-audio-buffer";
import { audioBufferToWhisperSamples } from "../../../utils/whisper-audio";
import {
  DEFAULT_WHISPER_MODEL,
  WHISPER_MODELS,
  isWhisperModelKey,
  type WhisperModelKey,
} from "../../../workers/whisper-models";
import { useGeminiSttApi } from "./hooks/useGeminiSttApi";

export type CaptionEngine = "gemini" | "whisper";

const CAPTION_STYLE_PRESETS = ["default", "modern", "bold", "cinematic", "minimal"] as const;
const CAPTION_FONTS = [
  { label: "Khmer OS (ពុម្ពខ្មែរ OS ស្តង់ដារ)", value: "Khmer OS" },
  { label: "Khmer OS Battambang (ខ្មែរ OS បាត់ដំបង)", value: "Khmer OS Battambang" },
  { label: "Khmer OS Siemreap (ខ្មែរ OS សៀមរាប)", value: "Khmer OS Siemreap" },
  { label: "Khmer OS System (ខ្មែរ OS ប្រព័ន្ធ)", value: "Khmer OS System" },
  { label: "Khmer OS Muol Light (ខ្មែរ OS មូល)", value: "Khmer OS Muol Light" },
  { label: "Kantumruy Pro (ខ្មែរ - ណែនាំ)", value: "Kantumruy Pro" },
  { label: "Battambang (ខ្មែរ បាត់ដំបង)", value: "Battambang" },
  { label: "Moul (ខ្មែរ មូល)", value: "Moul" },
  { label: "Siemreap (ខ្មែរ សៀមរាប)", value: "Siemreap" },
  { label: "Koulen (ខ្មែរ គូលែន)", value: "Koulen" },
  { label: "Noto Sans Khmer (ខ្មែរ)", value: "Noto Sans Khmer" },
  { label: "Noto Serif Khmer (ខ្មែរ)", value: "Noto Serif Khmer" },
  { label: "Bayon (ខ្មែរ បាយ័ន)", value: "Bayon" },
  { label: "Dangrek (ខ្មែរ ដងរែក)", value: "Dangrek" },
  { label: "Fasthand (ខ្មែរ)", value: "Fasthand" },
  { label: "Preahvihear (ខ្មែរ ព្រះវិហារ)", value: "Preahvihear" },
  { label: "Nokora (ខ្មែរ នគរា)", value: "Nokora" },
  { label: "Content (ខ្មែរ)", value: "Content" },
  { label: "Inter (English)", value: "Inter" },
  { label: "Poppins", value: "Poppins" },
  { label: "Montserrat", value: "Montserrat" },
  { label: "Roboto", value: "Roboto" },
] as const;
const WHISPER_LANGUAGES = [
  { code: "km", name: "Khmer (ភាសាខ្មែរ)" },
  { code: "en", name: "English" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "es", name: "Spanish" },
  { code: "it", name: "Italian" },
  { code: "pt", name: "Portuguese" },
  { code: "hi", name: "Hindi" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "zh", name: "Chinese" },
  { code: "ru", name: "Russian" },
  { code: "tr", name: "Turkish" },
  { code: "pl", name: "Polish" },
  { code: "vi", name: "Vietnamese" },
] as const;

interface AutoCaptionPanelProps {
  clipId?: string;
  maxWordsPerLine?: number;
}

interface WorkerChunk {
  text: string;
  timestamp: [number | null, number | null];
}

type WorkerState = "idle" | "loading" | "ready";

export const AutoCaptionPanel: React.FC<AutoCaptionPanelProps> = ({
  clipId,
  maxWordsPerLine = 5,
}) => {
  const getClip = useProjectStore((state) => state.getClip);
  const getMediaItem = useProjectStore((state) => state.getMediaItem);
  const addSubtitle = useProjectStore((state) => state.addSubtitle);
  const { transcribeWithGemini, hasGeminiKey, openSettings } = useGeminiSttApi();

  const workerRef = useRef<Worker | null>(null);
  const [workerState, setWorkerState] = useState<WorkerState>("idle");
  const [selectedEngine, setSelectedEngine] = useState<CaptionEngine>("gemini");
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [selectedLanguage, setSelectedLanguage] = useState("km");
  const [selectedStyle, setSelectedStyle] = useState<string>("default");
  const [selectedFontFamily, setSelectedFontFamily] = useState<string>("Khmer OS");

  const handleLanguageChange = useCallback((lang: string) => {
    setSelectedLanguage(lang);
    if (lang === "km") {
      setSelectedFontFamily("Khmer OS");
    }
  }, []);
  const [selectedModel, setSelectedModel] = useState<WhisperModelKey>(
    DEFAULT_WHISPER_MODEL,
  );
  const [readyModels, setReadyModels] = useState<Set<WhisperModelKey>>(
    () => new Set(),
  );
  const [modelBackends, setModelBackends] = useState<
    Partial<Record<WhisperModelKey, "webgpu" | "wasm">>
  >({});
  const [segments, setSegments] = useState<TranscriptionSegment[]>([]);
  const [error, setError] = useState<string | null>(null);

  const selectedItems = useUIStore((state) => state.selectedItems);
  const resolvedClipId =
    clipId ?? selectedItems.find((item) => item.type === "clip")?.id ?? "";
  const clip = getClip(resolvedClipId);
  const mediaItem = clip ? getMediaItem(clip.mediaId) : undefined;
  const canTranscribe = Boolean(
    clip && mediaItem && (mediaItem.type === "video" || mediaItem.type === "audio"),
  );

  useEffect(() => {
    const worker = new Worker(
      new URL("../../../workers/whisper-worker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const runWorker = useCallback(
    (
      type: "load" | "transcribe",
      audio?: Float32Array,
    ): Promise<{ text?: string; chunks?: WorkerChunk[] }> => {
      const worker = workerRef.current;
      if (!worker) return Promise.reject(new Error("Caption worker is not ready."));
      const requestId = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        const handleMessage = (event: MessageEvent<Record<string, unknown>>) => {
          if (event.data.requestId !== requestId) return;
          const messageType = event.data.type;
          if (messageType === "model-progress") {
            setWorkerState("loading");
            const rawProgress = Number(event.data.progress ?? 0);
            setProgress(rawProgress > 1 ? rawProgress / 100 : rawProgress);
            const file = String(event.data.file ?? "caption model").split("/").pop();
            setProgressMessage(`Downloading ${file || "caption model"}…`);
          } else if (messageType === "transcription-progress") {
            setWorkerState("ready");
            setProgress(Number(event.data.progress ?? 0));
            setProgressMessage("Transcribing selected clip locally…");
          } else if (messageType === "ready") {
            worker.removeEventListener("message", handleMessage);
            setWorkerState("ready");
            setReadyModels((current) => new Set(current).add(selectedModel));
            const backend = event.data.backend;
            if (backend === "webgpu" || backend === "wasm") {
              setModelBackends((current) => ({
                ...current,
                [selectedModel]: backend,
              }));
            }
            setProgress(1);
            setProgressMessage("Offline caption model is ready");
            resolve({});
          } else if (messageType === "result") {
            worker.removeEventListener("message", handleMessage);
            setWorkerState("ready");
            setReadyModels((current) => new Set(current).add(selectedModel));
            const backend = event.data.backend;
            if (backend === "webgpu" || backend === "wasm") {
              setModelBackends((current) => ({
                ...current,
                [selectedModel]: backend,
              }));
            }
            setProgress(1);
            resolve({
              text: String(event.data.text ?? ""),
              chunks: (event.data.chunks ?? []) as WorkerChunk[],
            });
          } else if (messageType === "error") {
            worker.removeEventListener("message", handleMessage);
            reject(new Error(String(event.data.message ?? "Local transcription failed.")));
          }
        };
        worker.addEventListener("message", handleMessage);
        if (audio) {
          worker.postMessage(
            {
              requestId,
              type,
              audio,
              language: selectedLanguage,
              model: selectedModel,
            },
            [audio.buffer],
          );
        } else {
          worker.postMessage({
            requestId,
            type,
            language: selectedLanguage,
            model: selectedModel,
          });
        }
      });
    },
    [selectedLanguage, selectedModel],
  );

  const handleModelChange = useCallback(
    (value: string) => {
      if (!isWhisperModelKey(value)) return;
      setSelectedModel(value);
      setSegments([]);
      setError(null);
      setProgress(readyModels.has(value) ? 1 : 0);
      setProgressMessage(readyModels.has(value) ? "Offline caption model is ready" : "");
      setWorkerState(readyModels.has(value) ? "ready" : "idle");
    },
    [readyModels],
  );

  const handlePrepareModel = useCallback(async () => {
    setError(null);
    setWorkerState("loading");
    setProgress(0);
    setProgressMessage("Preparing offline caption model…");
    try {
      await runWorker("load");
    } catch (reason) {
      setWorkerState("idle");
      setError(reason instanceof Error ? reason.message : "Model download failed.");
    }
  }, [runWorker]);

  const handleTranscribe = useCallback(async () => {
    if (!clip || !mediaItem) return;
    setError(null);
    setSegments([]);

    if (selectedEngine === "gemini" && !hasGeminiKey) {
      openSettings("api-keys");
      setError("សូមកំណត់ Google Gemini API Key ក្នុង Settings > API Keys ជាមុនសិន។");
      return;
    }

    setIsTranscribing(true);
    setProgress(0);
    setProgressMessage("Extracting selected clip audio…");

    let audioContext: AudioContext | null = null;
    try {
      const sourceBlob =
        mediaItem.blob ??
        (mediaItem.fileHandle ? await mediaItem.fileHandle.getFile() : null);
      if (!sourceBlob) {
        throw new Error("Reconnect the source media before creating captions.");
      }
      audioContext = new AudioContext();
      const audioBuffer = await loadAudioBuffer(audioContext, sourceBlob, {
        audioTrackIndex: clip.audioTrackIndex,
        onProgress: (next) => {
          setProgress(next.progress * 0.18);
          setProgressMessage(next.message);
        },
      });
      if (!audioBuffer) throw new Error("The selected clip audio could not be decoded.");

      const sourceStart = Math.max(0, clip.inPoint ?? 0);
      const sourceEnd = Math.min(
        audioBuffer.duration,
        clip.outPoint > sourceStart
          ? clip.outPoint
          : sourceStart + clip.duration * Math.max(clip.speed ?? 1, 0.01),
      );
      const samples = audioBufferToWhisperSamples(audioBuffer, sourceStart, sourceEnd);
      const sourceDuration = Math.max(0.1, sourceEnd - sourceStart);
      const playbackSpeed = Math.max(clip.speed ?? 1, 0.01);
      const clipEndTime = clip.startTime + clip.duration;

      if (selectedEngine === "gemini") {
        setProgress(0.35);
        setProgressMessage(
          selectedLanguage === "km"
            ? "Transcribing with Gemini AI (កំពុងបំប្លែងអក្សរខ្មែរ)…"
            : "Transcribing with Gemini Cloud AI…",
        );
        const geminiCues = await transcribeWithGemini(samples, selectedLanguage);
        setProgress(0.9);

        const nextSegments: TranscriptionSegment[] = geminiCues
          .map((cue) => {
            const start = Math.max(0, cue.startTime);
            const end = Math.min(
              sourceDuration,
              cue.endTime > start ? cue.endTime : start + 2.5,
            );
            return {
              text: cue.text.trim(),
              startTime: Math.min(clipEndTime, clip.startTime + start / playbackSpeed),
              endTime: Math.min(
                clipEndTime,
                clip.startTime + Math.max(start + 0.1, end) / playbackSpeed,
              ),
              confidence: 1,
            };
          })
          .filter(
            (segment) =>
              segment.text.length > 0 && segment.endTime > segment.startTime,
          );

        if (nextSegments.length === 0) {
          throw new Error("No speech was detected in the selected clip.");
        }
        setSegments(nextSegments);
        setProgress(1);
        setProgressMessage("Captions are ready to add");
      } else {
        setProgress(0.2);
        setProgressMessage(
          workerState === "ready"
            ? `Transcribing with ${WHISPER_MODELS[selectedModel].shortLabel}…`
            : `Downloading ${WHISPER_MODELS[selectedModel].shortLabel}, then transcribing…`,
        );
        const result = await runWorker("transcribe", samples);
        const nextSegments: TranscriptionSegment[] = (result.chunks ?? [])
          .map((chunk) => {
            const start = Math.max(0, chunk.timestamp?.[0] ?? 0);
            const end = Math.min(
              sourceDuration,
              chunk.timestamp?.[1] ?? Math.min(sourceDuration, start + 3),
            );
            return {
              text: chunk.text.trim(),
              startTime: Math.min(clipEndTime, clip.startTime + start / playbackSpeed),
              endTime: Math.min(
                clipEndTime,
                clip.startTime + Math.max(start + 0.1, end) / playbackSpeed,
              ),
              confidence: 1,
            };
          })
          .filter(
            (segment) =>
              segment.text.length > 0 && segment.endTime > segment.startTime,
          );
        if (nextSegments.length === 0 && result.text?.trim()) {
          nextSegments.push({
            text: result.text.trim(),
            startTime: clip.startTime,
            endTime: clipEndTime,
            confidence: 1,
          });
        }
        if (nextSegments.length === 0) {
          throw new Error("No speech was detected in the selected clip.");
        }
        setSegments(nextSegments);
        setProgressMessage("Captions are ready to add");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Transcription failed.");
    } finally {
      await audioContext?.close().catch(() => undefined);
      setIsTranscribing(false);
    }
  }, [
    clip,
    hasGeminiKey,
    mediaItem,
    openSettings,
    runWorker,
    selectedEngine,
    selectedLanguage,
    selectedModel,
    transcribeWithGemini,
    workerState,
  ]);

  const handleAddToTimeline = useCallback(async () => {
    if (!clip || segments.length === 0) return;
    const baseStyle = SUBTITLE_STYLE_PRESETS[selectedStyle] ?? SUBTITLE_STYLE_PRESETS.default;
    const style = {
      ...baseStyle,
      fontFamily: selectedFontFamily,
    };
    let addedCount = 0;
    for (const segment of segments) {
      const cues = splitCaptionIntoSingleLineCues(
        segment.text,
        segment.startTime,
        segment.endTime,
        maxWordsPerLine,
      );
      for (const cue of cues) {
        await addSubtitle(
          {
            id: `caption-${crypto.randomUUID()}`,
            text: cue.text,
            startTime: cue.startTime,
            endTime: cue.endTime,
            style,
          },
          {
            captionSource: selectedEngine === "gemini" ? "gemini" : "whisper",
            captionSourceClipId: clip.id,
            captionMaxWordsPerLine: maxWordsPerLine,
            captionWhisperModel: selectedEngine === "gemini" ? "gemini-flash" : selectedModel,
          },
        );
        addedCount += 1;
      }
    }
    setSegments([]);
    setProgressMessage(`${addedCount} single-line caption clips added`);
  }, [
    addSubtitle,
    clip,
    maxWordsPerLine,
    segments,
    selectedEngine,
    selectedModel,
    selectedStyle,
    selectedFontFamily,
  ]);

  const modelStatus = useMemo(() => {
    const model = WHISPER_MODELS[selectedModel];
    if (workerState === "ready") {
      const backend = modelBackends[selectedModel];
      return `Downloaded and cached${backend ? ` · ${backend === "webgpu" ? "GPU" : "CPU"}` : ""}`;
    }
    if (workerState === "loading") return progressMessage || "Downloading model…";
    return `${model.downloadSize} · ${model.description}`;
  }, [modelBackends, progressMessage, selectedModel, workerState]);

  return (
    <div className="w-full min-w-0 space-y-3">
      {/* Engine Selection */}
      <Card variant="muted" padding={3} className="space-y-2 border border-primary/20 bg-primary/5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Sparkles size={14} className="text-primary" aria-hidden />
            <Text type="supporting" weight="bold" className="text-[11px] text-fg">
              Engine (ម៉ាស៊ីនបកប្រែ)
            </Text>
          </div>
          <Selector
            label="Caption engine"
            isLabelHidden
            size="sm"
            width={176}
            value={selectedEngine}
            onChange={(val) => {
              setSelectedEngine(val as CaptionEngine);
              setError(null);
            }}
            isDisabled={isTranscribing}
            options={[
              { label: "Gemini AI (ខ្មែរ · ណែនាំ ⭐)", value: "gemini" },
              { label: "Whisper (Offline)", value: "whisper" },
            ]}
          />
        </div>

        {selectedEngine === "gemini" ? (
          <div className="space-y-2 pt-1 border-t border-border/40">
            {hasGeminiKey ? (
              <div className="flex items-center gap-1.5 text-emerald-400">
                <Check size={14} className="shrink-0" aria-hidden />
                <Text type="supporting" className="text-[10px] text-emerald-300">
                  Gemini Flash AI រួចរាល់ · ស្គាល់អក្សរខ្មែរត្រឹមត្រូវ ១០០%
                </Text>
              </div>
            ) : (
              <div className="space-y-2 rounded border border-amber-500/30 bg-amber-500/10 p-2">
                <div className="flex items-start gap-1.5 text-amber-400">
                  <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <Text type="supporting" weight="bold" className="text-[10px] text-amber-300 block">
                      ទាមទារ Google Gemini API Key
                    </Text>
                    <Text type="supporting" color="secondary" className="text-[9px] block leading-relaxed">
                      ដើម្បីបំប្លែងសំឡេងខ្មែរទៅជាអក្សរខ្មែរ សូមបញ្ចូល API Key ឥតគិតថ្លៃរបស់អ្នក។
                    </Text>
                  </div>
                </div>
                <Button
                  label="កំណត់ Gemini API Key ក្នុង Settings"
                  variant="secondary"
                  size="sm"
                  onClick={() => openSettings("api-keys")}
                  className="w-full justify-center text-[10px]"
                />
              </div>
            )}
            <Text type="supporting" color="secondary" className="block text-[9px] leading-relaxed">
              Google Gemini ស្គាល់អក្សរ និងពាក្យខ្មែរបានច្បាស់លាស់ គ្មានបញ្ហាចេញជាអក្សរឡាតាំងឡើយ។
            </Text>
          </div>
        ) : (
          <div className="space-y-2 pt-1 border-t border-border/40">
            <div className="flex items-center justify-between gap-2">
              <Text type="supporting" color="secondary" className="text-[10px]">
                Model quality
              </Text>
              <Selector
                label="Local caption model"
                isLabelHidden
                size="sm"
                width={176}
                value={selectedModel}
                onChange={handleModelChange}
                isDisabled={workerState === "loading" || isTranscribing}
                options={(
                  Object.entries(WHISPER_MODELS) as Array<
                    [WhisperModelKey, (typeof WHISPER_MODELS)[WhisperModelKey]]
                  >
                ).map(([value, model]) => ({
                  label: model.label,
                  value,
                }))}
              />
            </div>
            <div className="flex items-start gap-2">
              {workerState === "ready" ? (
                <Check size={15} className="mt-0.5 text-primary" aria-hidden />
              ) : (
                <Download size={15} className="mt-0.5 text-primary" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <Text type="supporting" weight="bold" className="block text-[11px] text-fg">
                  {WHISPER_MODELS[selectedModel].shortLabel}
                </Text>
                <Text type="supporting" color="secondary" className="block text-[9px]">
                  {modelStatus}
                </Text>
              </div>
            </div>
            {workerState === "loading" && (
              <div className="h-1.5 overflow-hidden rounded-full bg-bg-2">
                <div
                  className="h-full bg-primary transition-[width]"
                  style={{ width: `${Math.max(3, Math.min(100, progress * 100))}%` }}
                />
              </div>
            )}
            {workerState === "idle" && (
              <Button
                label={`Download ${WHISPER_MODELS[selectedModel].shortLabel}`}
                icon={<Download size={13} aria-hidden />}
                variant="secondary"
                size="sm"
                onClick={handlePrepareModel}
                className="w-full justify-center"
              />
            )}
            {selectedLanguage === "km" && (
              <div className="flex items-start gap-1.5 rounded bg-amber-500/10 p-1.5 text-[9px] text-amber-300 border border-amber-500/20">
                <AlertCircle size={12} className="mt-0.5 shrink-0 text-amber-400" />
                <span>Whisper អាចចេញអក្សរឡាតាំងសម្រាប់ខ្មែរ។ ណែនាំឱ្យប្តូរមកប្រើ <strong>Gemini AI</strong> ខាងលើ។</span>
              </div>
            )}
          </div>
        )}
      </Card>

      <Card variant="muted" padding={3} className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Languages size={14} className="text-fg-2" aria-hidden />
            <Text type="supporting" color="secondary" className="text-[10px]">Language</Text>
          </div>
          <Selector
            label="Caption language"
            isLabelHidden
            size="sm"
            width={140}
            value={selectedLanguage}
            onChange={handleLanguageChange}
            isDisabled={isTranscribing}
            options={WHISPER_LANGUAGES.map((language) => ({
              label: language.name,
              value: language.code,
            }))}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <Text type="supporting" color="secondary" className="text-[10px]">Font (ពុម្ពអក្សរ)</Text>
          <Selector
            label="Caption font"
            isLabelHidden
            size="sm"
            width={140}
            value={selectedFontFamily}
            onChange={setSelectedFontFamily}
            isDisabled={isTranscribing}
            options={CAPTION_FONTS.map((font) => ({
              label: font.label,
              value: font.value,
            }))}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <Text type="supporting" color="secondary" className="text-[10px]">Caption style</Text>
          <Selector
            label="Caption style"
            isLabelHidden
            size="sm"
            width={140}
            value={selectedStyle}
            onChange={setSelectedStyle}
            isDisabled={isTranscribing}
            options={CAPTION_STYLE_PRESETS.map((preset) => ({
              label: preset[0].toUpperCase() + preset.slice(1),
              value: preset,
            }))}
          />
        </div>
      </Card>

      {error && (
        <Card variant="muted" padding={2} className="flex items-start gap-2 border border-red-500/30 bg-red-500/10">
          <AlertCircle size={14} className="mt-0.5 shrink-0 text-red-400" aria-hidden />
          <Text type="supporting" className="text-[10px] text-red-400">{error}</Text>
        </Card>
      )}

      {isTranscribing && (
        <Card variant="muted" padding={3} className="flex items-center gap-2">
          <Loader2 size={14} className="animate-spin text-primary" aria-hidden />
          <Text type="supporting" color="secondary" className="text-[10px]">
            {progressMessage}
          </Text>
        </Card>
      )}

      {segments.length > 0 && (
        <div className="space-y-2">
          <div className="max-h-36 space-y-1 overflow-y-auto">
            {segments.map((segment, index) => (
              <Card key={`${segment.startTime}-${index}`} variant="muted" padding={2} className="text-[10px]">
                <span className="font-mono text-fg-muted">{segment.startTime.toFixed(1)}s</span>
                <span className="ml-2 text-fg">{segment.text}</span>
              </Card>
            ))}
          </div>
          <Button
            label={`Add ${segments.length} as Editable Text`}
            variant="primary"
            size="sm"
            onClick={handleAddToTimeline}
            className="w-full justify-center"
          />
        </div>
      )}

      <Button
        label={
          isTranscribing
            ? (selectedEngine === "gemini" ? "Transcribing with Gemini AI…" : "Transcribing Locally…")
            : (selectedEngine === "gemini" ? "✨ Transcribe with Gemini AI (ខ្មែរ)" : "Transcribe Selected Clip")
        }
        icon={
          isTranscribing ? (
            <Loader2 size={14} className="animate-spin" aria-hidden />
          ) : (
            <Sparkles size={14} aria-hidden />
          )
        }
        variant="primary"
        size="md"
        onClick={handleTranscribe}
        isDisabled={!canTranscribe || isTranscribing}
        className="w-full justify-center"
      />
      {!canTranscribe && (
        <Text type="supporting" color="secondary" className="block text-center text-[9px]">
          Select a connected video or audio clip first.
        </Text>
      )}
    </div>
  );
};

export default AutoCaptionPanel;
