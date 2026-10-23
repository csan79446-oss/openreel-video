import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import {
  Music,
  Zap,
  Play,
  Pause,
  Plus,
  Search,
  Clock,
  Volume2,
  Sparkles,
  Loader2,
  AlertTriangle,
  Settings,
  FolderPlus,
  Download,
} from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextInputControl } from "@openreel/ui";
import { ToolcraftTextAreaControl } from "@openreel/ui";
import { useEngineStore } from "../../../stores/engine-store";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useSettingsStore } from "../../../stores/settings-store";
import { toast } from "../../../stores/notification-store";
import {
  MUSIC_GENRES,
  SFX_CATEGORIES,
  MOOD_TAGS,
  type SoundItem,
  type MusicGenre,
  type SFXCategory,
  type MoodTag,
} from "@openreel/core";
import {
  SUNO_MODELS,
  createMusicTask,
  pollMusicTask,
  getMusicTracks,
  type SunoModelId,
  type VocalGender,
  type SunoTrackResult,
} from "../../../services/kieai";
import { KieAIError } from "../../../services/kieai/types";

type TabType = "music" | "sfx" | "ai-music";

const formatDuration = (seconds: number): string => {
  if (isNaN(seconds) || seconds <= 0) return "0:00";
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

const STYLE_PRESETS = [
  "Khmer Ballad",
  "Khmer Pop",
  "Acoustic",
  "Melancholic Piano",
  "R&B",
  "Lofi",
  "Cinematic",
  "Rock",
  "EDM",
];

interface SoundCardProps {
  sound: SoundItem;
  isPlaying: boolean;
  onPlay: () => void;
  onStop: () => void;
  onAdd: () => void;
}

const SoundCard: React.FC<SoundCardProps> = ({
  sound,
  isPlaying,
  onPlay,
  onStop,
  onAdd,
}) => {

  return (
    <Card variant="muted" padding={2} className="border border-border hover:border-primary/50 transition-colors">
      <div className="flex items-center gap-2">
        <IconButton
          label={isPlaying ? `Stop ${sound.name}` : `Preview ${sound.name}`}
          icon={
            isPlaying ? (
              <Pause size={14} aria-hidden />
            ) : (
              <Play size={14} className="ml-0.5" aria-hidden />
            )
          }
          variant={isPlaying ? "primary" : "secondary"}
          size="md"
          onClick={isPlaying ? onStop : onPlay}
        />
        <div className="flex-1 min-w-0">
          <Text type="supporting" color="primary" weight="bold" className="block text-[10px] truncate">
            {sound.name}
          </Text>
          <div className="flex items-center gap-2 mt-0.5">
            <div className="flex items-center gap-1 text-[9px] text-fg-3">
              <Clock size={10} aria-hidden />
              <Text type="supporting" color="secondary" className="text-[9px]">
                {formatDuration(sound.duration)}
              </Text>
            </div>
            {sound.bpm && (
              <Text type="supporting" color="secondary" className="text-[9px]">
                {sound.bpm} BPM
              </Text>
            )}
          </div>
        </div>
        <IconButton
          label={`Add ${sound.name} to timeline`}
          icon={<Plus size={14} aria-hidden />}
          variant="primary"
          size="sm"
          onClick={onAdd}
        />
      </div>
      {sound.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {sound.tags.slice(0, 3).map((tag) => (
            <Text
              key={tag}
              type="supporting"
              color="secondary"
              className="px-1.5 py-0.5 text-[8px] bg-bg-1 rounded"
            >
              {tag}
            </Text>
          ))}
        </div>
      )}
    </Card>
  );
};

export const MusicLibraryPanel: React.FC = () => {
  const getSoundLibraryEngine = useEngineStore((state) => state.getSoundLibraryEngine);
  const importMedia = useProjectStore((state) => state.importMedia);
  const project = useProjectStore((state) => state.project);
  const playheadPosition = useTimelineStore((state) => state.playheadPosition);

  const { configuredServices, openSettings } = useSettingsStore();
  const hasKieKey = configuredServices.includes("kie-ai");

  const [activeTab, setActiveTab] = useState<TabType>("music");
  const [selectedGenre, setSelectedGenre] = useState<MusicGenre | "all">("all");
  const [selectedSfxCategory, setSelectedSfxCategory] = useState<SFXCategory | "all">("all");
  const [selectedMoods, setSelectedMoods] = useState<MoodTag[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [allMusic, setAllMusic] = useState<SoundItem[]>([]);
  const [allSfx, setAllSfx] = useState<SoundItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // AI Music generation state
  const [aiMode, setAiMode] = useState<"custom" | "simple">("custom");
  const [aiTitle, setAiTitle] = useState("");
  const [aiStyle, setAiStyle] = useState("");
  const [aiLyrics, setAiLyrics] = useState("");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiVocalGender, setAiVocalGender] = useState<VocalGender>("auto");
  const [aiModel, setAiModel] = useState<SunoModelId>("V6");
  const [isInstrumental, setIsInstrumental] = useState(false);
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [aiStatus, setAiStatus] = useState("");
  const [aiElapsed, setAiElapsed] = useState(0);
  const [aiTracks, setAiTracks] = useState<SunoTrackResult[]>([]);
  const [selectedTrackIdx, setSelectedTrackIdx] = useState(0);
  const [aiResultUrl, setAiResultUrl] = useState<string | null>(null);
  const [isAiPlaying, setIsAiPlaying] = useState(false);
  const [isAddingAiToMedia, setIsAddingAiToMedia] = useState(false);
  const [isAddingAiToTimeline, setIsAddingAiToTimeline] = useState(false);

  const aiTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const aiAbortRef = useRef<AbortController | null>(null);
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadSounds = async () => {
      setIsLoading(true);
      try {
        const engine = await getSoundLibraryEngine();
        await engine.ensureInitialized();
        if (!cancelled) {
          setAllMusic(engine.getMusic());
          setAllSfx(engine.getSFX());
        }
      } catch (err) {
        console.error("[MusicLibraryPanel] Failed to initialize sound engine:", err);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };
    loadSounds();
    return () => {
      cancelled = true;
      if (aiTimerRef.current) clearInterval(aiTimerRef.current);
      aiAbortRef.current?.abort();
      if (audioPreviewRef.current) {
        audioPreviewRef.current.pause();
      }
    };
  }, [getSoundLibraryEngine]);

  const sounds = useMemo(() => {
    let results = activeTab === "music" ? allMusic : allSfx;
    if (results.length === 0) return [];

    if (activeTab === "music" && selectedGenre !== "all") {
      results = results.filter((s) => s.subcategory === selectedGenre);
    }

    if (activeTab === "sfx" && selectedSfxCategory !== "all") {
      results = results.filter((s) => s.subcategory === selectedSfxCategory);
    }

    if (selectedMoods.length > 0) {
      results = results.filter((s) =>
        s.mood?.some((m) => selectedMoods.includes(m)),
      );
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      results = results.filter(
        (s) =>
          s.name.toLowerCase().includes(query) ||
          s.tags.some((t) => t.toLowerCase().includes(query)),
      );
    }

    return results;
  }, [
    allMusic,
    allSfx,
    activeTab,
    selectedGenre,
    selectedSfxCategory,
    selectedMoods,
    searchQuery,
  ]);

  const handlePlay = useCallback(
    async (sound: SoundItem) => {
      const engine = await getSoundLibraryEngine();

      if (playingId === sound.id) {
        engine.stopPreview();
        setPlayingId(null);
      } else {
        engine.stopPreview();
        setPlayingId(sound.id);
        await engine.previewSound(sound);
      }
    },
    [getSoundLibraryEngine, playingId],
  );

  const handleStop = useCallback(async () => {
    const engine = await getSoundLibraryEngine();
    engine.stopPreview();
    setPlayingId(null);
  }, [getSoundLibraryEngine]);

  const handleAddToTimeline = useCallback(
    async (sound: SoundItem) => {
      if (!project) return;

      const engine = await getSoundLibraryEngine();
      const blob = engine.getSoundBlob(sound.id);
      if (!blob) {
        console.error("[MusicLibrary] Failed to get sound blob for:", sound.id);
        return;
      }

      const file = new File([blob], `${sound.name}.wav`, { type: "audio/wav" });
      const importResult = await importMedia(file);

      if (!importResult.success || !importResult.actionId) {
        console.error(
          "[MusicLibrary] Failed to import sound:",
          importResult.error,
        );
        return;
      }

      const mediaId = importResult.actionId;
      const { addClipToNewTrack } = useProjectStore.getState();
      await addClipToNewTrack(mediaId, playheadPosition);
    },
    [project, getSoundLibraryEngine, importMedia, playheadPosition],
  );

  const toggleMood = useCallback((mood: MoodTag) => {
    setSelectedMoods((prev) =>
      prev.includes(mood) ? prev.filter((m) => m !== mood) : [...prev, mood],
    );
  }, []);

  // ─── AI Music Handlers ───────────────────────────────────────────────────────
  const handleInsertLyricsTemplate = () => {
    const template = `[Verse 1]\n\n[Chorus]\n\n[Verse 2]\n\n[Chorus]\n\n[Outro]`;
    setAiLyrics((prev) => (prev.trim() ? `${prev.trim()}\n\n${template}` : template));
  };

  const handleGenerateAiMusic = async () => {
    if (aiMode === "custom") {
      if (!aiStyle.trim() && !aiLyrics.trim() && !aiPrompt.trim()) {
        toast.warning(
          "Input required",
          "Please enter a music style (e.g. Khmer ballad, acoustic) or lyrics to generate a custom song.",
        );
        return;
      }
    } else {
      if (!aiPrompt.trim()) {
        toast.warning("Prompt required", "Please describe the music genre, instruments, and mood.");
        return;
      }
    }

    setIsAiGenerating(true);
    setAiStatus("Creating Suno task on Kie.ai...");
    setAiElapsed(0);
    setAiTracks([]);
    setSelectedTrackIdx(0);
    setAiResultUrl(null);
    setIsAiPlaying(false);
    if (audioPreviewRef.current) {
      audioPreviewRef.current.pause();
      audioPreviewRef.current = null;
    }

    const controller = new AbortController();
    aiAbortRef.current = controller;

    aiTimerRef.current = setInterval(() => {
      setAiElapsed((prev) => prev + 1);
    }, 1000);

    try {
      const taskId = await createMusicTask({
        custom_mode: aiMode === "custom",
        title: aiTitle.trim() || undefined,
        style: aiStyle.trim() || undefined,
        lyrics: aiLyrics.trim() || undefined,
        prompt:
          aiMode === "simple"
            ? aiPrompt.trim()
            : (aiLyrics.trim() || aiStyle.trim() || aiPrompt.trim()),
        instrumental: isInstrumental,
        model: aiModel,
        vocal_gender:
          isInstrumental || aiVocalGender === "auto" ? undefined : (aiVocalGender as "m" | "f"),
      });

      setAiStatus("Synthesizing audio arrangement...");

      const record = await pollMusicTask(
        taskId,
        (rec) => {
          if (rec.state === "queuing" || rec.state === "waiting") {
            setAiStatus("Queued on Suno server...");
          } else if (rec.state === "generating") {
            setAiStatus("Generating audio waveforms & arrangements...");
          }
        },
        controller.signal,
      );

      const tracks = getMusicTracks(record);
      setAiTracks(tracks);
      setSelectedTrackIdx(0);
      setAiResultUrl(tracks[0]?.audioUrl || null);
      toast.success(
        "AI Song generated!",
        `Ready with ${tracks.length} track${tracks.length > 1 ? "s" : ""}. Preview, save to media, or add to timeline.`,
      );
    } catch (err: any) {
      if (err.name === "AbortError") return;
      console.error("[MusicLibraryPanel] AI Music generation failed:", err);
      const msg = err instanceof KieAIError ? err.message : err?.message || "Failed to generate music";
      toast.error("Generation failed", msg);
    } finally {
      setIsAiGenerating(false);
      setAiStatus("");
      if (aiTimerRef.current) clearInterval(aiTimerRef.current);
    }
  };

  const handleSelectTrack = (idx: number) => {
    if (idx === selectedTrackIdx) return;
    if (audioPreviewRef.current) {
      audioPreviewRef.current.pause();
    }
    setIsAiPlaying(false);
    setSelectedTrackIdx(idx);
    setAiResultUrl(aiTracks[idx]?.audioUrl || null);
  };

  const toggleAiPlayback = () => {
    const currentTrack = aiTracks[selectedTrackIdx];
    const targetUrl = currentTrack?.audioUrl || aiResultUrl;
    if (!targetUrl) return;

    if (!audioPreviewRef.current || audioPreviewRef.current.src !== targetUrl) {
      if (audioPreviewRef.current) {
        audioPreviewRef.current.pause();
      }
      const audio = new Audio(targetUrl);
      audio.onended = () => setIsAiPlaying(false);
      audioPreviewRef.current = audio;
    }

    if (isAiPlaying) {
      audioPreviewRef.current.pause();
      setIsAiPlaying(false);
    } else {
      handleStop();
      audioPreviewRef.current.play().catch((e) => {
        console.error("[MusicLibraryPanel] Audio playback failed:", e);
        setIsAiPlaying(false);
      });
      setIsAiPlaying(true);
    }
  };

  const fetchAiAudioFile = async (): Promise<File> => {
    const currentTrack = aiTracks[selectedTrackIdx];
    const targetUrl = currentTrack?.audioUrl || aiResultUrl;
    if (!targetUrl) throw new Error("No generated music URL");
    const res = await fetch(targetUrl);
    if (!res.ok) throw new Error("Failed to download audio file");
    const blob = await res.blob();
    const cleanTitle = (currentTrack?.title || aiTitle || "suno_song")
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .slice(0, 30);
    const filename = `${cleanTitle || "suno_song"}_${Date.now()}.mp3`;
    return new File([blob], filename, { type: blob.type || "audio/mpeg" });
  };

  const handleSaveAiToMedia = async () => {
    setIsAddingAiToMedia(true);
    try {
      const file = await fetchAiAudioFile();
      const res = await importMedia(file);
      if (res.success) {
        toast.success("Saved to Media Library", `"${file.name}" stored in your media assets.`);
      } else {
        toast.error("Import failed", res.error?.message || "Could not save to Media");
      }
    } catch (err: any) {
      console.error("[MusicLibraryPanel] Save AI audio failed:", err);
      toast.error("Save to media failed", err.message || "Unknown error");
    } finally {
      setIsAddingAiToMedia(false);
    }
  };

  const handleAddAiToTimeline = async () => {
    setIsAddingAiToTimeline(true);
    try {
      const file = await fetchAiAudioFile();
      const res = await importMedia(file);
      if (res.success && res.actionId) {
        const { addClipToNewTrack } = useProjectStore.getState();
        await addClipToNewTrack(res.actionId, playheadPosition);
        toast.success("Added to Timeline", "AI Music imported to media and placed on timeline audio track.");
      } else {
        toast.error("Import failed", res.error?.message || "Could not add to timeline");
      }
    } catch (err: any) {
      console.error("[MusicLibraryPanel] Add AI audio to timeline failed:", err);
      toast.error("Add to timeline failed", err.message || "Unknown error");
    } finally {
      setIsAddingAiToTimeline(false);
    }
  };

  const handleDownloadAiAudio = () => {
    const currentTrack = aiTracks[selectedTrackIdx];
    const targetUrl = currentTrack?.audioUrl || aiResultUrl;
    if (!targetUrl) return;
    const cleanTitle = (currentTrack?.title || aiTitle || "suno_song")
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .slice(0, 30);
    const a = document.createElement("a");
    a.href = targetUrl;
    a.download = `${cleanTitle || "suno_song"}_${Date.now()}.mp3`;
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="space-y-3">
      <Card variant="green" padding={2} className="flex items-center gap-2 border border-primary/30">
        <Music size={16} className="text-primary" aria-hidden />
        <div className="flex flex-col gap-0.5">
          <Text type="body" color="primary" weight="bold" className="text-[11px]">
            Music & SFX
          </Text>
          <Text type="supporting" color="secondary" className="text-[9px]">
            Royalty-free sounds & Kie.ai Suno generator
          </Text>
        </div>
      </Card>

      <div className="flex gap-1">
        <Button
          label="Music"
          icon={<Music size={12} aria-hidden />}
          variant={activeTab === "music" ? "primary" : "secondary"}
          size="sm"
          onClick={() => setActiveTab("music")}
          className="flex-1 text-[11px]"
        />
        <Button
          label="Sound FX"
          icon={<Zap size={12} aria-hidden />}
          variant={activeTab === "sfx" ? "primary" : "secondary"}
          size="sm"
          onClick={() => setActiveTab("sfx")}
          className="flex-1 text-[11px]"
        />
        <Button
          label="AI Generate"
          icon={<Sparkles size={12} aria-hidden />}
          variant={activeTab === "ai-music" ? "primary" : "secondary"}
          size="sm"
          onClick={() => setActiveTab("ai-music")}
          className="flex-1 text-[11px]"
        />
      </div>

      {activeTab === "ai-music" ? (
        <div className="space-y-3 pt-1">
          {!hasKieKey && (
            <Card variant="muted" padding={2.5} className="border border-yellow-500/30 bg-yellow-500/10 space-y-1.5">
              <div className="flex items-center gap-1.5 text-yellow-400">
                <AlertTriangle size={14} />
                <Text type="label" weight="bold" className="text-[11px] text-yellow-400">
                  Kie.ai API Key Required
                </Text>
              </div>
              <Text type="supporting" className="text-[10px] text-text-secondary">
                To generate custom AI music with Suno, please configure your Kie.ai key.
              </Text>
              <Button
                label="Open Settings"
                variant="secondary"
                size="sm"
                icon={<Settings size={12} />}
                onClick={() => openSettings("api-keys")}
                className="w-full text-[10px]"
              />
            </Card>
          )}

          {/* Mode Switcher */}
          <div className="flex gap-1 p-0.5 bg-bg-1 rounded-lg border border-border">
            <Button
              label="Custom (Lyrics & Style)"
              variant={aiMode === "custom" ? "primary" : "ghost"}
              size="sm"
              onClick={() => setAiMode("custom")}
              className="flex-1 text-[10px]"
            />
            <Button
              label="Simple Prompt"
              variant={aiMode === "simple" ? "primary" : "ghost"}
              size="sm"
              onClick={() => setAiMode("simple")}
              className="flex-1 text-[10px]"
            />
          </div>

          {aiMode === "custom" ? (
            <>
              {/* Song Title */}
              <div className="space-y-1">
                <Text type="supporting" color="secondary" weight="bold" className="text-[10px] uppercase">
                  Song Title (Optional)
                </Text>
                <ToolcraftTextInputControl
                  label="Song Title"
                  isLabelHidden
                  value={aiTitle}
                  onChange={setAiTitle}
                  placeholder="e.g. My Heartbeat in Phnom Penh"
                  size="sm"
                  width="100%"
                />
              </div>

              {/* Music Style & Genre */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Text type="supporting" color="secondary" weight="bold" className="text-[10px] uppercase">
                    Music Style & Genre
                  </Text>
                  <Text type="supporting" color="secondary" className="text-[9px]">
                    Max 1000 chars
                  </Text>
                </div>
                <ToolcraftTextAreaControl
                  label="Music Style & Genre"
                  isLabelHidden
                  value={aiStyle}
                  onChange={setAiStyle}
                  placeholder="e.g. Soulful Khmer ballad, acoustic guitar, melancholic piano, slow tempo around 68 BPM..."
                  rows={2}
                  size="sm"
                />
                {/* Style chips */}
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {STYLE_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        setAiStyle((prev) => (prev.trim() ? `${prev.trim()}, ${preset}` : preset));
                      }}
                      className="px-1.5 py-0.5 text-[9px] bg-bg-2 hover:bg-bg-3 border border-border rounded text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
                    >
                      +{preset}
                    </button>
                  ))}
                </div>
              </div>

              {/* Lyrics */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Text type="supporting" color="secondary" weight="bold" className="text-[10px] uppercase">
                    Lyrics
                  </Text>
                  <button
                    type="button"
                    onClick={handleInsertLyricsTemplate}
                    className="text-[9px] text-primary hover:underline cursor-pointer"
                  >
                    + Insert Structure
                  </button>
                </div>
                <ToolcraftTextAreaControl
                  label="Lyrics"
                  isLabelHidden
                  value={aiLyrics}
                  onChange={setAiLyrics}
                  placeholder={`[Verse 1]\nUnderneath the starry sky...\n\n[Chorus]\nHear the melody tonight...`}
                  rows={4}
                  size="sm"
                />
              </div>

              {/* Vocal Gender Selector */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Text type="supporting" color="secondary" weight="bold" className="text-[10px] uppercase">
                    Vocal Voice
                  </Text>
                  {isInstrumental && (
                    <Text type="supporting" color="secondary" className="text-[9px] italic">
                      (Disabled in Instrumental)
                    </Text>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-1">
                  <Button
                    label="Auto / Both"
                    variant={aiVocalGender === "auto" && !isInstrumental ? "primary" : "secondary"}
                    size="sm"
                    disabled={isInstrumental}
                    onClick={() => setAiVocalGender("auto")}
                    className="text-[10px]"
                  />
                  <Button
                    label="Male (m)"
                    variant={aiVocalGender === "m" && !isInstrumental ? "primary" : "secondary"}
                    size="sm"
                    disabled={isInstrumental}
                    onClick={() => setAiVocalGender("m")}
                    className="text-[10px]"
                  />
                  <Button
                    label="Female (f)"
                    variant={aiVocalGender === "f" && !isInstrumental ? "primary" : "secondary"}
                    size="sm"
                    disabled={isInstrumental}
                    onClick={() => setAiVocalGender("f")}
                    className="text-[10px]"
                  />
                </div>
              </div>
            </>
          ) : (
            /* Simple Mode Prompt */
            <div className="space-y-1.5">
              <Text type="supporting" color="secondary" weight="bold" className="text-[10px] uppercase">
                Music Prompt
              </Text>
              <ToolcraftTextAreaControl
                label="Music Prompt"
                isLabelHidden
                value={aiPrompt}
                onChange={setAiPrompt}
                placeholder="Soulful expressive Khmer vocals, intimate acoustic guitar, melancholic piano, slow tempo around 68 BPM..."
                rows={3}
                size="sm"
              />
            </div>
          )}

          {/* Model and Track Style */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Text type="supporting" color="secondary" weight="bold" className="text-[10px] uppercase">
                Suno Model
              </Text>
              <div className="flex flex-col gap-1">
                {SUNO_MODELS.slice(0, 4).map((m) => (
                  <Button
                    key={m.id}
                    label={m.name}
                    variant={aiModel === m.id ? "primary" : "secondary"}
                    size="sm"
                    onClick={() => setAiModel(m.id)}
                    className="justify-start text-[10px]"
                  />
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <Text type="supporting" color="secondary" weight="bold" className="text-[10px] uppercase">
                Track Style
              </Text>
              <div className="flex flex-col gap-1">
                <Button
                  label="With Vocals"
                  variant={!isInstrumental ? "primary" : "secondary"}
                  size="sm"
                  onClick={() => setIsInstrumental(false)}
                  className="justify-start text-[10px]"
                />
                <Button
                  label="Instrumental"
                  variant={isInstrumental ? "primary" : "secondary"}
                  size="sm"
                  onClick={() => setIsInstrumental(true)}
                  className="justify-start text-[10px]"
                />
              </div>
            </div>
          </div>

          <Button
            label={isAiGenerating ? `Generating (${aiElapsed}s)...` : "Generate AI Music"}
            variant="primary"
            size="md"
            icon={isAiGenerating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            disabled={
              isAiGenerating ||
              !hasKieKey ||
              (aiMode === "custom"
                ? !aiStyle.trim() && !aiLyrics.trim() && !aiPrompt.trim()
                : !aiPrompt.trim())
            }
            onClick={handleGenerateAiMusic}
            className="w-full font-bold"
          />

          {isAiGenerating && (
            <div className="p-3 rounded-lg border border-primary/20 bg-primary/5 text-center space-y-1">
              <Loader2 size={16} className="animate-spin mx-auto text-primary" />
              <Text type="supporting" color="primary" weight="bold" className="text-[11px] block">
                {aiStatus}
              </Text>
              <Text type="supporting" color="secondary" className="text-[9px] block">
                Generating high-fidelity track. Elapsed: {aiElapsed}s
              </Text>
            </div>
          )}

          {/* Result Player */}
          {(aiTracks.length > 0 || aiResultUrl) && (
            <Card variant="muted" padding={2.5} className="space-y-2.5 border border-primary/30">
              {/* Multi-track tabs if Suno generated more than 1 variation */}
              {aiTracks.length > 1 && (
                <div className="flex items-center gap-1 p-1 bg-bg-1 rounded-md border border-border">
                  {aiTracks.map((tr, idx) => (
                    <button
                      key={tr.id || idx}
                      type="button"
                      onClick={() => handleSelectTrack(idx)}
                      className={`flex-1 py-1 px-2 rounded text-[10px] font-semibold transition-colors cursor-pointer ${
                        selectedTrackIdx === idx
                          ? "bg-primary text-black"
                          : "text-text-secondary hover:text-text-primary hover:bg-bg-2"
                      }`}
                    >
                      Track {idx + 1} {tr.duration ? `(${formatDuration(tr.duration)})` : ""}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <IconButton
                    label={isAiPlaying ? "Pause music" : "Play music"}
                    icon={isAiPlaying ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
                    variant="primary"
                    size="md"
                    onClick={toggleAiPlayback}
                  />
                  <div className="min-w-0">
                    <Text type="body" color="primary" weight="bold" className="text-[11px] block truncate">
                      {aiTracks[selectedTrackIdx]?.title || aiTitle || "Generated Song"}
                    </Text>
                    <Text type="supporting" color="secondary" className="text-[9px] block truncate">
                      Suno {aiModel} • {isInstrumental ? "Instrumental" : aiVocalGender === "m" ? "Male Vocal" : aiVocalGender === "f" ? "Female Vocal" : "Vocal"}
                      {aiTracks[selectedTrackIdx]?.duration
                        ? ` • ${formatDuration(aiTracks[selectedTrackIdx]!.duration!)}`
                        : ""}
                    </Text>
                  </div>
                </div>

                {aiTracks[selectedTrackIdx]?.imageUrl && (
                  <img
                    src={aiTracks[selectedTrackIdx]!.imageUrl}
                    alt="Cover"
                    className="w-9 h-9 rounded object-cover border border-border shrink-0"
                  />
                )}
              </div>

              <div className="flex gap-1.5">
                <Button
                  label={isAddingAiToMedia ? "Saving..." : "Add to Media"}
                  variant="secondary"
                  size="sm"
                  icon={<FolderPlus size={12} />}
                  disabled={isAddingAiToMedia}
                  onClick={handleSaveAiToMedia}
                  className="flex-1 text-[10px]"
                />
                <Button
                  label={isAddingAiToTimeline ? "Adding..." : "Add to Timeline"}
                  variant="primary"
                  size="sm"
                  icon={<Plus size={12} />}
                  disabled={isAddingAiToTimeline}
                  onClick={handleAddAiToTimeline}
                  className="flex-1 text-[10px]"
                />
                <Button
                  label="Download"
                  variant="ghost"
                  size="sm"
                  icon={<Download size={12} />}
                  onClick={handleDownloadAiAudio}
                  className="text-[10px]"
                />
              </div>
            </Card>
          )}
        </div>
      ) : (
        <>
          <div className="relative">
            <ToolcraftTextInputControl
              label="Search sounds"
              isLabelHidden
              size="sm"
              width="100%"
              placeholder="Search sounds..."
              value={searchQuery}
              onChange={setSearchQuery}
              startIcon={<Search size={14} aria-hidden />}
            />
          </div>

          {activeTab === "music" && (
            <div className="flex gap-1 overflow-x-auto pb-1">
              <Button
                label="All"
                variant={selectedGenre === "all" ? "primary" : "secondary"}
                size="sm"
                onClick={() => setSelectedGenre("all")}
                className="shrink-0 whitespace-nowrap text-[9px]"
              />
              {MUSIC_GENRES.map((genre) => (
                <Button
                  key={genre.id}
                  label={genre.name}
                  variant={selectedGenre === genre.id ? "primary" : "secondary"}
                  size="sm"
                  onClick={() => setSelectedGenre(genre.id)}
                  className="shrink-0 whitespace-nowrap text-[9px]"
                />
              ))}
            </div>
          )}

          {activeTab === "sfx" && (
            <div className="flex gap-1 overflow-x-auto pb-1">
              <Button
                label="All"
                variant={selectedSfxCategory === "all" ? "primary" : "secondary"}
                size="sm"
                onClick={() => setSelectedSfxCategory("all")}
                className="shrink-0 whitespace-nowrap text-[9px]"
              />
              {SFX_CATEGORIES.map((cat) => (
                <Button
                  key={cat.id}
                  label={cat.name}
                  variant={selectedSfxCategory === cat.id ? "primary" : "secondary"}
                  size="sm"
                  onClick={() => setSelectedSfxCategory(cat.id)}
                  className="shrink-0 whitespace-nowrap text-[9px]"
                />
              ))}
            </div>
          )}

          {activeTab === "music" && (
            <div className="flex flex-wrap gap-1">
              {MOOD_TAGS.slice(0, 6).map((mood) => (
                <Button
                  key={mood.id}
                  label={mood.name}
                  variant={selectedMoods.includes(mood.id) ? "primary" : "secondary"}
                  size="sm"
                  onClick={() => toggleMood(mood.id)}
                  className="rounded-full text-[8px]"
                />
              ))}
            </div>
          )}

          <div className="space-y-2 max-h-64 overflow-y-auto">
            {isLoading ? (
              <div className="text-center py-6">
                <Text type="supporting" color="secondary" className="block text-[11px]">
                  Generating built-in sounds...
                </Text>
              </div>
            ) : sounds.length === 0 ? (
              <div className="text-center py-6">
                <Volume2
                  size={24}
                  className="mx-auto mb-2 text-fg-3 opacity-50"
                  aria-hidden
                />
                <Text type="supporting" color="secondary" className="block text-[10px]">
                  No sounds found
                </Text>
                <Text type="supporting" color="secondary" className="block text-[9px] mt-1">
                  Try adjusting filters
                </Text>
              </div>
            ) : (
              sounds.map((sound) => (
                <SoundCard
                  key={sound.id}
                  sound={sound}
                  isPlaying={playingId === sound.id}
                  onPlay={() => handlePlay(sound)}
                  onStop={handleStop}
                  onAdd={() => handleAddToTimeline(sound)}
                />
              ))
            )}
          </div>

          <Text type="supporting" color="secondary" className="block text-[9px] text-center">
            {sounds.length} {activeTab === "music" ? "tracks" : "effects"} available
          </Text>
        </>
      )}
    </div>
  );
};

export default MusicLibraryPanel;
