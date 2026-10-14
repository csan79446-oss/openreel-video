import React from "react";
import { Volume2 } from "@/icons/lucide-compat";
import { ToolcraftSelectableCard as SelectableCard } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { GEMINI_VOICES, type GeminiVoice } from "./hooks/useGeminiTtsApi";

interface GeminiVoiceSelectorProps {
  selectedVoice: string;
  onSelectVoice: (voiceId: string) => void;
}

export const GeminiVoiceSelector: React.FC<GeminiVoiceSelectorProps> = ({
  selectedVoice,
  onSelectVoice,
}) => {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Text type="supporting" color="secondary" weight="bold" className="text-[10px] uppercase">
          Gemini Voices (Google AI)
        </Text>
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
          Multilingual / Khmer Supported
        </span>
      </div>

      <div className="grid grid-cols-1 gap-1.5">
        {GEMINI_VOICES.map((voice: GeminiVoice) => {
          const isSelected = selectedVoice === voice.id;
          return (
            <SelectableCard
              key={voice.id}
              label={voice.name}
              isSelected={isSelected}
              onClick={() => onSelectVoice(voice.id)}
              padding={2}
              className={`flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                isSelected
                  ? "border-primary bg-primary/10"
                  : "border-border bg-bg-2 hover:bg-bg-3"
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                    isSelected ? "bg-primary text-white" : "bg-bg-3 text-fg-2"
                  }`}
                >
                  <Volume2 size={13} aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <Text type="body" weight="bold" className="text-[11px] truncate">
                      {voice.name}
                    </Text>
                    <span
                      className={`text-[8px] px-1 py-0.2 rounded font-medium ${
                        voice.gender === "female"
                          ? "bg-pink-500/15 text-pink-400"
                          : "bg-blue-500/15 text-blue-400"
                      }`}
                    >
                      {voice.gender === "female" ? "Female" : "Male"}
                    </span>
                  </div>
                  <Text type="supporting" color="secondary" className="text-[9px] truncate block">
                    {voice.description}
                  </Text>
                </div>
              </div>
            </SelectableCard>
          );
        })}
      </div>
    </div>
  );
};
