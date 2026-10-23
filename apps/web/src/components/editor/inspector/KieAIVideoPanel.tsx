import React, { useState, useRef, useEffect } from "react";
import {
  Video,
  Loader2,
  Download,
  Plus,
  FolderPlus,
  AlertTriangle,
  Settings,
  Sparkles,
  Image as ImageIcon,
  Upload,
  X,
  FolderOpen,
  Link as LinkIcon,
} from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextAreaControl } from "@openreel/ui";
import { ToolcraftTextInputControl } from "@openreel/ui";
import { useSettingsStore } from "../../../stores/settings-store";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { toast } from "../../../stores/notification-store";
import {
  VIDEO_MODEL_INFOS,
  createVideoTask,
  pollVideoTask,
  getVideoResultUrl,
  uploadFileStream,
  type VideoModelId,
} from "../../../services/kieai";
import { loadMediaBlob } from "../../../services/media-storage";
import { KieAIError } from "../../../services/kieai/types";
import type { MediaItem } from "@openreel/core";

const ASPECT_RATIOS: { value: "16:9" | "9:16" | "1:1"; label: string }[] = [
  { value: "16:9", label: "16:9 Landscape" },
  { value: "9:16", label: "9:16 Vertical" },
  { value: "1:1", label: "1:1 Square" },
];

const DURATIONS = [5, 10];

type VideoGenerationMode = "prompt" | "image";

export const KieAIVideoPanel: React.FC = () => {
  const { configuredServices, openSettings } = useSettingsStore();
  const { project, importMedia } = useProjectStore();
  const playheadPosition = useTimelineStore((s) => s.playheadPosition);

  const hasKey = configuredServices.includes("kie-ai");

  const [generationMode, setGenerationMode] = useState<VideoGenerationMode>("image");
  const [selectedModel, setSelectedModel] = useState<VideoModelId>(VIDEO_MODEL_INFOS[0].id);
  const [prompt, setPrompt] = useState("");
  
  // Image reference state
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string>("");
  const [imageUrl, setImageUrl] = useState<string>("");
  const [imageSourceLabel, setImageSourceLabel] = useState<string>("");
  const [showMediaPicker, setShowMediaPicker] = useState<boolean>(false);
  const [showUrlInput, setShowUrlInput] = useState<boolean>(false);

  const [aspectRatio, setAspectRatio] = useState<"16:9" | "9:16" | "1:1">("16:9");
  const [duration, setDuration] = useState<number>(5);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progressStatus, setProgressStatus] = useState<string>("");
  const [elapsed, setElapsed] = useState(0);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [isAddingToMedia, setIsAddingToMedia] = useState(false);
  const [isAddingToTimeline, setIsAddingToTimeline] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Available images in project Media Library
  const projectImages = (project?.mediaLibrary?.items || []).filter(
    (item: MediaItem) => item.type === "image",
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      abortControllerRef.current?.abort();
    };
  }, []);

  const activeModelInfo = VIDEO_MODEL_INFOS.find((m) => m.id === selectedModel);

  const handleSelectModel = (modelId: VideoModelId) => {
    setSelectedModel(modelId);
    const target = VIDEO_MODEL_INFOS.find((m) => m.id === modelId);
    if (target && !target.supportsSquare && aspectRatio === "1:1") {
      setAspectRatio("16:9");
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.warning("Invalid file", "Please select an image file (PNG, JPG, WebP).");
      return;
    }
    setSelectedImageFile(file);
    setImagePreviewUrl(URL.createObjectURL(file));
    setImageSourceLabel(file.name);
    setImageUrl("");
    setShowMediaPicker(false);
    setShowUrlInput(false);
  };

  const handleSelectMediaItem = async (item: MediaItem) => {
    try {
      const blob = await loadMediaBlob(item.id);
      if (!blob) {
        toast.error("Could not load image", "Media file not found in storage.");
        return;
      }
      const file = new File([blob], item.name, { type: blob.type || "image/png" });
      setSelectedImageFile(file);
      setImagePreviewUrl(item.thumbnailUrl || URL.createObjectURL(file));
      setImageSourceLabel(item.name);
      setImageUrl("");
      setShowMediaPicker(false);
      setShowUrlInput(false);
    } catch (err: any) {
      console.error("[KieAIVideoPanel] Failed to load media item blob:", err);
      toast.error("Failed to load image", err.message || "Unknown error");
    }
  };

  const handleUrlInputConfirm = (url: string) => {
    setImageUrl(url);
    if (url.trim().startsWith("http://") || url.trim().startsWith("https://")) {
      setSelectedImageFile(null);
      setImagePreviewUrl(url.trim());
      setImageSourceLabel("Remote URL");
    }
  };

  const handleClearImage = () => {
    setSelectedImageFile(null);
    setImagePreviewUrl("");
    setImageUrl("");
    setImageSourceLabel("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      toast.warning("Prompt required", "Please describe the video motion and scene.");
      return;
    }

    if (generationMode === "image" && !imagePreviewUrl && !imageUrl.trim() && !selectedImageFile) {
      toast.warning("Source image required", "Please select an image for Image-to-Video generation, or switch to Prompt mode.");
      return;
    }

    setIsGenerating(true);
    setProgressStatus("Preparing generation task...");
    setElapsed(0);
    setResultUrl(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    timerRef.current = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);

    try {
      let resolvedImageUrl: string | undefined = undefined;

      // Handle image upload if in image mode or if an image is provided
      if (generationMode === "image" || imagePreviewUrl) {
        if (selectedImageFile) {
          setProgressStatus("Uploading source image to Kie.ai CDN...");
          const uploaded = await uploadFileStream(selectedImageFile, {
            fileName: selectedImageFile.name || "source-frame.png",
          });
          resolvedImageUrl = uploaded.fileUrl;
        } else if (imageUrl.trim()) {
          resolvedImageUrl = imageUrl.trim();
        }
      }

      setProgressStatus("Submitting video task to Kie.ai...");

      const input: any = {
        prompt: prompt.trim(),
        aspect_ratio: aspectRatio,
        duration,
        quality: "720p",
      };

      if (resolvedImageUrl) {
        input.image_url = resolvedImageUrl;
      }

      const taskId = await createVideoTask(selectedModel, input);
      setProgressStatus("Task queued in GPU cluster...");

      const record = await pollVideoTask(
        taskId,
        (rec) => {
          if (rec.state === "waiting" || rec.state === "queuing") {
            setProgressStatus("Queued in GPU cluster...");
          } else if (rec.state === "generating") {
            setProgressStatus("Rendering video stream with AI...");
          }
        },
        controller.signal,
      );

      const url = getVideoResultUrl(record);
      setResultUrl(url);
      toast.success("Video generated!", "Your AI video clip is ready to preview, save to media, or add to timeline.");
    } catch (err: any) {
      if (err.name === "AbortError") return;
      console.error("[KieAIVideoPanel] Generation failed:", err);
      const msg = err instanceof KieAIError ? err.message : err?.message || "Failed to generate video";
      toast.error("Video generation failed", msg);
    } finally {
      setIsGenerating(false);
      setProgressStatus("");
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const fetchResultFile = async (): Promise<File> => {
    if (!resultUrl) throw new Error("No video generated");
    const res = await fetch(resultUrl);
    if (!res.ok) throw new Error("Failed to download generated video file");
    const blob = await res.blob();
    const filename = `kieai_video_${Date.now()}.mp4`;
    return new File([blob], filename, { type: blob.type || "video/mp4" });
  };

  const handleSaveToMedia = async () => {
    setIsAddingToMedia(true);
    try {
      const file = await fetchResultFile();
      const res = await importMedia(file);
      if (res.success) {
        toast.success("Saved to Media Library", `"${file.name}" is now stored in your media assets.`);
      } else {
        toast.error("Import failed", res.error?.message || "Could not save to Media");
      }
    } catch (err: any) {
      console.error("[KieAIVideoPanel] Save to media failed:", err);
      toast.error("Save to media failed", err.message || "Unknown error");
    } finally {
      setIsAddingToMedia(false);
    }
  };

  const handleAddToTimeline = async () => {
    setIsAddingToTimeline(true);
    try {
      const file = await fetchResultFile();
      const res = await importMedia(file);
      if (res.success && res.actionId) {
        const { addClipToNewTrack } = useProjectStore.getState();
        await addClipToNewTrack(res.actionId, playheadPosition);
        toast.success("Added to Timeline", "Video imported to media and placed on timeline track.");
      } else {
        toast.error("Import failed", res.error?.message || "Could not place on timeline");
      }
    } catch (err: any) {
      console.error("[KieAIVideoPanel] Add to timeline failed:", err);
      toast.error("Add to timeline failed", err.message || "Unknown error");
    } finally {
      setIsAddingToTimeline(false);
    }
  };

  const handleDownload = () => {
    if (!resultUrl) return;
    const a = document.createElement("a");
    a.href = resultUrl;
    a.download = `kieai_video_${Date.now()}.mp4`;
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card variant="green" padding={3} className="border border-cyan-500/30 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center text-cyan-400">
            <Video size={18} aria-hidden />
          </div>
          <div>
            <Text type="body" color="primary" weight="bold" className="text-[12px]">
              AI Video Generation
            </Text>
            <Text type="supporting" color="secondary" className="text-[10px]">
              Prompt & Image to Video • Powered by Kie.ai
            </Text>
          </div>
        </div>
      </Card>

      {!hasKey && (
        <Card variant="muted" padding={3} className="border border-yellow-500/30 bg-yellow-500/10 space-y-2">
          <div className="flex items-center gap-2 text-yellow-400">
            <AlertTriangle size={15} />
            <Text type="label" weight="bold" className="text-[11px] text-yellow-400">
              Kie.ai API Key Required
            </Text>
          </div>
          <Text type="supporting" className="text-[10px] text-text-secondary">
            To generate AI videos, please configure your Kie.ai API key in settings.
          </Text>
          <Button
            label="Open Settings"
            variant="secondary"
            size="sm"
            icon={<Settings size={12} />}
            onClick={() => openSettings("api-keys")}
            className="w-full text-[11px]"
          />
        </Card>
      )}

      {/* Mode Selector: Prompt to Video vs Image to Video */}
      <div className="flex rounded-lg p-1 bg-background-tertiary border border-border">
        <button
          type="button"
          onClick={() => setGenerationMode("prompt")}
          className={`flex-1 py-1.5 px-3 rounded text-[11px] font-semibold transition-all flex items-center justify-center gap-1.5 ${
            generationMode === "prompt"
              ? "bg-cyan-500 text-black shadow-sm"
              : "text-text-secondary hover:text-text-primary"
          }`}
        >
          <Sparkles size={13} />
          Prompt to Video
        </button>
        <button
          type="button"
          onClick={() => setGenerationMode("image")}
          className={`flex-1 py-1.5 px-3 rounded text-[11px] font-semibold transition-all flex items-center justify-center gap-1.5 ${
            generationMode === "image"
              ? "bg-cyan-500 text-black shadow-sm"
              : "text-text-secondary hover:text-text-primary"
          }`}
        >
          <ImageIcon size={13} />
          Image to Video
        </button>
      </div>

      {/* Model Selection */}
      <div className="space-y-2">
        <Text type="supporting" color="secondary" weight="bold" className="text-[10px] uppercase">
          Video Model
        </Text>
        <div className="space-y-1.5">
          {VIDEO_MODEL_INFOS.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => handleSelectModel(m.id)}
              className={`w-full p-2.5 rounded-lg border text-left transition-all ${
                selectedModel === m.id
                  ? "bg-cyan-500/10 border-cyan-500/60 ring-1 ring-cyan-500/30"
                  : "bg-background-tertiary border-border text-text-secondary hover:border-border-strong hover:bg-background-elevated"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[11px] text-text-primary">{m.name}</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-background-secondary text-text-muted">
                  {m.provider}
                </span>
              </div>
              <div className="text-[10px] text-text-muted mt-0.5 line-clamp-1">{m.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Image Reference Section for Image to Video */}
      {generationMode === "image" && (
        <div className="space-y-2 p-3 rounded-lg border border-cyan-500/30 bg-cyan-500/5">
          <div className="flex items-center justify-between">
            <Text type="supporting" color="primary" weight="bold" className="text-[10px] uppercase flex items-center gap-1.5">
              <ImageIcon size={12} className="text-cyan-400" />
              Source Image (Reference Frame)
            </Text>
            {imagePreviewUrl && (
              <button
                type="button"
                onClick={handleClearImage}
                className="text-[10px] text-red-400 hover:text-red-300 flex items-center gap-1 transition-colors"
              >
                <X size={12} /> Remove
              </button>
            )}
          </div>

          {/* Hidden File Input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={handleFileChange}
          />

          {imagePreviewUrl ? (
            /* Selected Image Preview Card */
            <div className="space-y-2">
              <div className="relative rounded-lg overflow-hidden border border-border bg-black max-h-48 flex items-center justify-center">
                <img
                  src={imagePreviewUrl}
                  alt="Source reference"
                  className="w-full h-auto max-h-48 object-contain"
                />
              </div>
              <div className="flex items-center justify-between text-[10px] text-text-muted">
                <span className="truncate max-w-[200px] font-medium text-text-secondary">
                  {imageSourceLabel || "Image ready"}
                </span>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-cyan-400 hover:text-cyan-300 font-medium"
                >
                  Change Image
                </button>
              </div>
            </div>
          ) : (
            /* Image Dropzone & Pickers */
            <div className="space-y-2">
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files?.[0];
                  if (file) {
                    if (!file.type.startsWith("image/")) {
                      toast.warning("Invalid file", "Please drop an image file.");
                      return;
                    }
                    setSelectedImageFile(file);
                    setImagePreviewUrl(URL.createObjectURL(file));
                    setImageSourceLabel(file.name);
                    setImageUrl("");
                  }
                }}
                className="border-2 border-dashed border-cyan-500/40 hover:border-cyan-500/80 rounded-lg p-4 text-center cursor-pointer bg-background-elevated/40 hover:bg-background-elevated transition-all space-y-1.5"
              >
                <Upload size={20} className="mx-auto text-cyan-400" />
                <div className="text-[11px] font-medium text-text-primary">
                  Click or drag & drop an image here
                </div>
                <div className="text-[9px] text-text-muted">
                  Supports PNG, JPG, WebP • Auto-uploaded to Kie.ai
                </div>
              </div>

              {/* Media Library Picker / URL Toggle */}
              <div className="flex gap-2">
                {projectImages.length > 0 && (
                  <Button
                    label={showMediaPicker ? "Hide Project Media" : `Pick from Media (${projectImages.length})`}
                    variant="secondary"
                    size="sm"
                    icon={<FolderOpen size={12} />}
                    onClick={() => setShowMediaPicker(!showMediaPicker)}
                    className="flex-1 text-[10px]"
                  />
                )}
                <Button
                  label={showUrlInput ? "Hide URL" : "Paste Image URL"}
                  variant="ghost"
                  size="sm"
                  icon={<LinkIcon size={12} />}
                  onClick={() => setShowUrlInput(!showUrlInput)}
                  className="text-[10px]"
                />
              </div>

              {/* Project Media Grid */}
              {showMediaPicker && projectImages.length > 0 && (
                <div className="p-2 rounded-lg bg-background-secondary border border-border space-y-1.5">
                  <Text type="supporting" className="text-[10px] text-text-muted">
                    Click an image from your project media:
                  </Text>
                  <div className="grid grid-cols-3 gap-1.5 max-h-36 overflow-y-auto">
                    {projectImages.map((img: MediaItem) => (
                      <button
                        key={img.id}
                        type="button"
                        onClick={() => handleSelectMediaItem(img)}
                        className="group relative rounded border border-border overflow-hidden hover:border-cyan-500 aspect-video bg-black flex items-center justify-center transition-colors"
                      >
                        {img.thumbnailUrl ? (
                          <img src={img.thumbnailUrl} alt={img.name} className="w-full h-full object-cover" />
                        ) : (
                          <ImageIcon size={14} className="text-text-muted" />
                        )}
                        <span className="absolute inset-x-0 bottom-0 bg-black/80 text-[8px] text-text-primary px-1 truncate">
                          {img.name}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Direct URL input */}
              {showUrlInput && (
                <div className="space-y-1">
                  <ToolcraftTextInputControl
                    label="Image URL"
                    isLabelHidden
                    value={imageUrl}
                    onChange={handleUrlInputConfirm}
                    placeholder="https://... (direct public image link)"
                    size="sm"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Motion Prompt */}
      <div className="space-y-1.5">
        <Text type="supporting" color="secondary" weight="bold" className="text-[10px] uppercase">
          {generationMode === "image" ? "Motion Prompt (Image to Video)" : "Scene & Motion Prompt"}
        </Text>
        <ToolcraftTextAreaControl
          label="Motion Prompt"
          isLabelHidden
          value={prompt}
          onChange={setPrompt}
          placeholder={
            generationMode === "image"
              ? "The camera slowly pushes in while the subject smiles naturally, gentle wind blowing through the scene, cinematic lighting..."
              : "Slow pan of a cyberpunk alley with neon reflections and steam rising, cinematic lighting, 4k..."
          }
          rows={3}
          size="sm"
        />
        <Text type="supporting" color="secondary" className="text-[9px]">
          {generationMode === "image"
            ? "Describe how the image should animate, camera movement, character actions, or physics."
            : "Describe the entire scene, visual environment, character actions, and camera angles."}
        </Text>
      </div>

      {/* Video Output Controls: Aspect Ratio and Duration */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Text type="supporting" color="secondary" weight="bold" className="text-[10px] uppercase">
            Aspect Ratio
          </Text>
          <div className="flex flex-col gap-1">
            {ASPECT_RATIOS.filter(
              (r) => activeModelInfo?.supportsSquare || r.value !== "1:1",
            ).map((r) => (
              <Button
                key={r.value}
                label={r.label}
                variant={aspectRatio === r.value ? "primary" : "secondary"}
                size="sm"
                onClick={() => setAspectRatio(r.value)}
                className="justify-start text-[10px]"
              />
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Text type="supporting" color="secondary" weight="bold" className="text-[10px] uppercase">
            Duration
          </Text>
          <div className="flex flex-col gap-1">
            {DURATIONS.map((d) => (
              <Button
                key={d}
                label={`${d} Seconds`}
                variant={duration === d ? "primary" : "secondary"}
                size="sm"
                onClick={() => setDuration(d)}
                className="justify-start text-[10px]"
              />
            ))}
          </div>
        </div>
      </div>

      {/* Submit Generate Button */}
      <Button
        label={
          isGenerating
            ? `Generating Video (${elapsed}s)...`
            : generationMode === "image"
              ? "Generate Video from Image & Prompt"
              : "Generate Video"
        }
        variant="primary"
        size="md"
        icon={isGenerating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
        disabled={isGenerating || !hasKey || !prompt.trim() || (generationMode === "image" && !imagePreviewUrl && !imageUrl.trim() && !selectedImageFile)}
        onClick={handleGenerate}
        className="w-full font-bold"
      />

      {isGenerating && (
        <div className="p-3 rounded-lg border border-cyan-500/20 bg-cyan-500/5 text-center space-y-1">
          <Loader2 size={18} className="animate-spin mx-auto text-cyan-400" />
          <Text type="supporting" color="primary" weight="bold" className="text-[11px] block">
            {progressStatus}
          </Text>
          <Text type="supporting" color="secondary" className="text-[9px] block">
            Video generation usually takes 30–90 seconds. Elapsed: {elapsed}s
          </Text>
        </div>
      )}

      {/* Generated Video Preview & Actions */}
      {resultUrl && (
        <div className="space-y-3 pt-2 border-t border-border">
          <Text type="supporting" color="primary" weight="bold" className="text-[11px] block">
            Generated Video Preview
          </Text>
          <div className="rounded-lg overflow-hidden border border-border bg-black">
            <video src={resultUrl} controls className="w-full h-auto max-h-56" autoPlay loop muted playsInline />
          </div>
          <div className="flex gap-1.5">
            <Button
              label={isAddingToMedia ? "Saving..." : "Add to Media"}
              variant="secondary"
              size="sm"
              icon={<FolderPlus size={13} />}
              disabled={isAddingToMedia}
              onClick={handleSaveToMedia}
              className="flex-1 text-[10px]"
            />
            <Button
              label={isAddingToTimeline ? "Adding..." : "Add to Timeline"}
              variant="primary"
              size="sm"
              icon={<Plus size={13} />}
              disabled={isAddingToTimeline}
              onClick={handleAddToTimeline}
              className="flex-1 text-[10px]"
            />
            <Button
              label="Download"
              variant="ghost"
              size="sm"
              icon={<Download size={13} />}
              onClick={handleDownload}
              className="text-[10px]"
            />
          </div>
        </div>
      )}
    </div>
  );
};
