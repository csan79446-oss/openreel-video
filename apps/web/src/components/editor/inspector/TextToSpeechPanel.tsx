import React, { useState, useCallback, useMemo } from "react";
import {
  Mic,
  Loader2,
  Volume2,
  Settings,
  Sparkles,
  AlertTriangle,
  Radio,
  Bot,
} from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextAreaControl } from "@openreel/ui";
import { MockToggle } from "./shell/InspectorControls";
import { useSettingsStore } from "../../../stores/settings-store";
import { useElevenLabsApi } from "./hooks/useElevenLabsApi";
import { useGeminiTtsApi, GEMINI_VOICES } from "./hooks/useGeminiTtsApi";
import { useTtsActions } from "./hooks/useTtsActions";
import { VoiceBrowser } from "./VoiceBrowser";
import { GeminiVoiceSelector } from "./GeminiVoiceSelector";
import { ModelSelector } from "./ModelSelector";
import { EnhancedTextPreview } from "./EnhancedTextPreview";
import { AudioResult } from "./AudioResult";

export const TextToSpeechPanel: React.FC = () => {
  const {
    defaultTtsProvider,
    setDefaultTtsProvider,
    geminiVoice,
    setGeminiVoice,
    defaultLlmProvider,
    llmBaseUrl,
    llmModel,
    openSettings,
    settingsOpen,
    configuredServices,
    elevenLabsModel,
    favoriteVoices,
  } = useSettingsStore();

  const hasElevenLabsKey = configuredServices.includes("elevenlabs");
  const hasGeminiKey = configuredServices.includes("gemini");
  const hasActiveKey = defaultTtsProvider === "gemini" ? hasGeminiKey : hasElevenLabsKey;

  const [text, setText] = useState("");
  const [selectedVoice, setSelectedVoice] = useState<string>(
    favoriteVoices.length > 0 ? favoriteVoices[0].voiceId : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [enhanceText, setEnhanceText] = useState(false);
  const [enhancedPreview, setEnhancedPreview] = useState<string | null>(null);

  const {
    allVoices,
    allModels,
    isLoadingVoices,
    isLoadingModels,
    generateWithElevenLabs,
    enhanceViaLlm,
  } = useElevenLabsApi({
    hasElevenLabsKey,
    settingsOpen,
    elevenLabsModel,
    defaultLlmProvider,
    llmBaseUrl,
    llmModel,
  });

  const { generateWithGemini } = useGeminiTtsApi();

  const activeGenerator = useCallback(
    async (inputText: string, voiceId: string, signal?: AbortSignal): Promise<Blob> => {
      if (defaultTtsProvider === "gemini") {
        return generateWithGemini(inputText, geminiVoice, signal);
      }
      return generateWithElevenLabs(inputText, voiceId, signal);
    },
    [defaultTtsProvider, geminiVoice, generateWithGemini, generateWithElevenLabs],
  );

  const {
    isGenerating,
    isPlaying,
    isEnhancing,
    generatedAudio,
    hasUnsavedAudio,
    successMsg,
    audioRef,
    getSelectedVoiceName,
    handleEnhance,
    generateSpeech,
    togglePlayback,
    handleAudioEnded,
    saveToMedia,
    addToTimeline,
    downloadAudio,
  } = useTtsActions({
    selectedVoice: defaultTtsProvider === "gemini" ? geminiVoice : selectedVoice,
    text,
    enhanceText,
    enhancedPreview,
    allVoices,
    favoriteVoices,
    generateWithElevenLabs: activeGenerator,
    enhanceViaLlm,
    setText,
    setError,
    setEnhancedPreview,
  });

  const getSelectedModelName = (): string => {
    if (defaultTtsProvider === "gemini") return "Gemini 3.8 Flash Audio";
    const model = allModels.find((m) => m.model_id === elevenLabsModel);
    if (model) return model.name;
    return elevenLabsModel;
  };

  const currentVoiceName = useMemo(() => {
    if (defaultTtsProvider === "gemini") {
      const match = GEMINI_VOICES.find((v) => v.id === geminiVoice);
      return match ? `Gemini (${match.name})` : `Gemini (${geminiVoice})`;
    }
    return getSelectedVoiceName();
  }, [defaultTtsProvider, geminiVoice, getSelectedVoiceName]);

  const charCount = text.length;
  const maxChars = 5000;

  return (
    <div className="space-y-3 w-full min-w-0 max-w-full">
      <audio ref={audioRef as React.RefObject<HTMLAudioElement>} onEnded={handleAudioEnded} className="hidden" />

      {/* Header with settings trigger */}
      <Card
        variant="green"
        padding={2}
        className="flex items-center justify-between border border-primary/30"
      >
        <div className="flex items-center gap-2">
          <Mic size={16} className="text-primary" aria-hidden />
          <div className="flex flex-col gap-0.5 min-w-0">
            <Text type="body" color="primary" weight="bold" display="block" className="text-[11px]">
              AI Voice & Text to Speech
            </Text>
            <Text type="supporting" color="secondary" display="block" className="text-[9px]">
              {defaultTtsProvider === "gemini"
                ? "Google Gemini 3.8 Flash Audio (Khmer/Multilingual)"
                : "ElevenLabs Voice Generation"}
            </Text>
          </div>
        </div>
        <IconButton
          label="API Key Settings"
          icon={<Settings size={14} aria-hidden />}
          variant="ghost"
          size="sm"
          onClick={() => openSettings("api-keys")}
          className="text-fg-3 hover:text-fg"
        />
      </Card>

      {/* Provider Switcher: ElevenLabs vs Gemini TTS */}
      <div className="space-y-1">
        <Text type="supporting" color="secondary" weight="bold" className="text-[10px] uppercase">
          TTS Provider (ជ្រើសរើស AI Voice Engine)
        </Text>
        <div className="grid grid-cols-2 gap-1.5 p-1 rounded-lg bg-bg-2 border border-border">
          <button
            type="button"
            onClick={() => {
              setDefaultTtsProvider("elevenlabs");
              setError(null);
            }}
            className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-[11px] font-medium transition-colors ${
              defaultTtsProvider === "elevenlabs"
                ? "bg-primary text-white shadow-sm"
                : "text-fg-2 hover:text-fg hover:bg-bg-3"
            }`}
          >
            <Radio size={12} className={defaultTtsProvider === "elevenlabs" ? "text-white" : "text-fg-muted"} />
            <span>ElevenLabs</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setDefaultTtsProvider("gemini");
              setError(null);
            }}
            className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-[11px] font-medium transition-colors ${
              defaultTtsProvider === "gemini"
                ? "bg-primary text-white shadow-sm"
                : "text-fg-2 hover:text-fg hover:bg-bg-3"
            }`}
          >
            <Bot size={12} className={defaultTtsProvider === "gemini" ? "text-white" : "text-fg-muted"} />
            <span>Gemini TTS</span>
          </button>
        </div>
      </div>

      {/* API Key Notices */}
      {defaultTtsProvider === "elevenlabs" && !hasElevenLabsKey && (
        <Card variant="yellow" padding={2} className="border border-amber-500/30">
          <Text type="supporting" className="text-[10px] text-amber-400">
            Add your ElevenLabs API key in Settings &gt; API Keys to enable ElevenLabs voice generation.
          </Text>
        </Card>
      )}

      {defaultTtsProvider === "gemini" && !hasGeminiKey && (
        <Card variant="yellow" padding={2} className="border border-amber-500/30">
          <Text type="supporting" className="text-[10px] text-amber-400">
            Add your Google Gemini (AI Studio) API key in Settings &gt; API Keys to generate speech with Gemini TTS.
          </Text>
        </Card>
      )}

      {/* Provider-specific selectors */}
      {defaultTtsProvider === "elevenlabs" && hasElevenLabsKey && (
        <ModelSelector allModels={allModels} isLoadingModels={isLoadingModels} />
      )}

      {/* Text input area */}
      <div className="space-y-2">
        <ToolcraftTextAreaControl
          label="Text to Speak (អត្ថបទនិយាយ)"
          value={text}
          onChange={(value) => {
            setText(value);
            setEnhancedPreview(null);
          }}
          placeholder={
            defaultTtsProvider === "gemini"
              ? "វាយ ឬ paste អត្ថបទនៅទីនេះ (គាំទ្រទាំងភាសាខ្មែរ និងអង់គ្លេស)..."
              : "Enter the text you want to convert to speech..."
          }
          maxLength={maxChars}
          rows={4}
          width="100%"
        />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <MockToggle
              ariaLabel="Enhance for TTS"
              checked={enhanceText}
              onChange={setEnhanceText}
            />
            <Text
              type="supporting"
              color="secondary"
              className="flex items-center gap-1 text-[9px] cursor-pointer"
              onClick={() => setEnhanceText(!enhanceText)}
            >
              <Sparkles size={10} className={enhanceText ? "text-amber-400" : ""} aria-hidden />
              Enhance for TTS
            </Text>
          </div>
          <Text
            type="supporting"
            className={`text-[9px] ${charCount > maxChars * 0.9 ? "text-red-400" : "text-fg-3"}`}
          >
            {charCount}/{maxChars}
          </Text>
        </div>

        {enhancedPreview && enhanceText && (
          <EnhancedTextPreview
            enhancedPreview={enhancedPreview}
            onUpdate={setEnhancedPreview}
            onDiscard={() => setEnhancedPreview(null)}
          />
        )}
      </div>

      {/* Voice Browsers */}
      {defaultTtsProvider === "elevenlabs" ? (
        <VoiceBrowser
          selectedVoice={selectedVoice}
          onSelectVoice={setSelectedVoice}
          allVoices={allVoices}
          isLoadingVoices={isLoadingVoices}
        />
      ) : (
        <GeminiVoiceSelector
          selectedVoice={geminiVoice}
          onSelectVoice={setGeminiVoice}
        />
      )}

      {/* Error alert */}
      {error && (
        <Card
          variant="red"
          padding={2}
          className="flex items-center justify-between gap-2 border border-red-500/30"
        >
          <Text type="supporting" className="text-[10px] text-red-400">
            {error}
          </Text>
          {(error.includes("API key") || error.includes("Session locked") || error.includes("Unlock")) && (
            <Button
              label="Open Settings"
              variant="secondary"
              size="sm"
              onClick={() => openSettings("api-keys")}
              className="shrink-0 text-[9px]"
            />
          )}
        </Card>
      )}

      {/* Success alert */}
      {successMsg && (
        <Card variant="green" padding={2} className="border border-green-500/30">
          <Text type="supporting" className="text-[10px] text-green-400">
            {successMsg}
          </Text>
        </Card>
      )}

      {/* Enhance action button */}
      {enhanceText && !enhancedPreview && (
        <Button
          label={isEnhancing ? "Enhancing..." : "Enhance Text"}
          icon={
            isEnhancing ? (
              <Loader2 size={14} className="animate-spin" aria-hidden />
            ) : (
              <Sparkles size={14} aria-hidden />
            )
          }
          variant="primary"
          size="md"
          onClick={handleEnhance}
          isDisabled={isEnhancing || !text.trim()}
          isLoading={isEnhancing}
          className="w-full"
        />
      )}

      {/* Generate action button */}
      <Button
        label={
          isGenerating
            ? "Generating Speech…"
            : defaultTtsProvider === "gemini"
              ? "Generate with Gemini TTS"
              : "Generate with ElevenLabs"
        }
        icon={
          isGenerating ? (
            <Loader2 size={14} className="animate-spin" aria-hidden />
          ) : (
            <Volume2 size={14} aria-hidden />
          )
        }
        variant="primary"
        size="md"
        onClick={generateSpeech}
        isDisabled={
          isGenerating ||
          !hasActiveKey ||
          !text.trim() ||
          (defaultTtsProvider === "elevenlabs" && !selectedVoice) ||
          (enhanceText && !enhancedPreview)
        }
        isLoading={isGenerating}
        className="w-full"
      />

      {/* Unsaved audio warning */}
      {hasUnsavedAudio && (
        <Card
          variant="yellow"
          padding={2}
          className="flex items-center gap-1.5 border border-amber-500/30"
        >
          <AlertTriangle size={12} className="text-amber-400 shrink-0" aria-hidden />
          <Text type="supporting" className="text-[9px] text-amber-400">
            Unsaved audio — save to media, add to timeline, or download to keep it.
          </Text>
        </Card>
      )}

      {/* Audio player and action buttons */}
      {generatedAudio && (
        <AudioResult
          generatedAudio={generatedAudio}
          voiceName={currentVoiceName}
          isPlaying={isPlaying}
          isGenerating={isGenerating}
          onTogglePlayback={togglePlayback}
          onSaveToMedia={saveToMedia}
          onAddToTimeline={addToTimeline}
          onDownload={downloadAudio}
        />
      )}

      <Text type="supporting" color="secondary" className="block text-[9px] text-center">
        Powered by {defaultTtsProvider === "gemini" ? "Google Gemini 3.8 Flash Audio" : `ElevenLabs · ${getSelectedModelName()}`}
      </Text>
    </div>
  );
};

export default TextToSpeechPanel;
