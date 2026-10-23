import React, { useState, useRef, useEffect } from "react";
import {
  Sparkles,
  Loader2,
  Download,
  Plus,
  FolderPlus,
  AlertTriangle,
  Settings,
} from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextAreaControl } from "@openreel/ui";
import { useSettingsStore } from "../../../stores/settings-store";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { toast } from "../../../stores/notification-store";
import {
  IMAGE_MODELS,
  createImageTask,
  pollTask,
  getResultUrl,
  type ImageModelId,
  type AspectRatio,
} from "../../../services/kieai";
import { KieAIError } from "../../../services/kieai/types";

const MODEL_OPTIONS: { id: ImageModelId; name: string; desc: string }[] = [
  { id: IMAGE_MODELS.Z_IMAGE, name: "Z-Image", desc: "Fast text-to-image synthesis" },
  { id: IMAGE_MODELS.FLUX2, name: "Flux 2 Pro", desc: "Photorealistic detailing and anatomy" },
  { id: IMAGE_MODELS.SEEDREAM, name: "Seedream 5 Lite", desc: "Cinematic lighting & artistic compositions" },
  { id: IMAGE_MODELS.NANO_BANANA2, name: "Nano Banana 2", desc: "Versatile creative concept art" },
  { id: IMAGE_MODELS.GROK, name: "Grok Imagine", desc: "High imagination and surreal visuals" },
  { id: IMAGE_MODELS.QWEN, name: "Qwen Image", desc: "Fine-grained semantic control" },
];

const ASPECT_RATIOS: { value: AspectRatio; label: string }[] = [
  { value: "1:1", label: "1:1 Square" },
  { value: "16:9", label: "16:9 Widescreen" },
  { value: "9:16", label: "9:16 Portrait" },
  { value: "4:3", label: "4:3 Standard" },
  { value: "3:4", label: "3:4 Vertical" },
];

export const KieAIImagePanel: React.FC = () => {
  const { configuredServices, openSettings } = useSettingsStore();
  const { importMedia } = useProjectStore();
  const playheadPosition = useTimelineStore((s) => s.playheadPosition);

  const hasKey = configuredServices.includes("kie-ai");

  const [model, setModel] = useState<ImageModelId>(IMAGE_MODELS.Z_IMAGE);
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
  const [isGenerating, setIsGenerating] = useState(false);
  const [progressStatus, setProgressStatus] = useState<string>("");
  const [elapsed, setElapsed] = useState(0);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [isAddingToMedia, setIsAddingToMedia] = useState(false);
  const [isAddingToTimeline, setIsAddingToTimeline] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      abortControllerRef.current?.abort();
    };
  }, []);

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      toast.warning("Prompt required", "Please enter a description for the image you want to generate.");
      return;
    }

    setIsGenerating(true);
    setProgressStatus("Submitting task to Kie.ai...");
    setElapsed(0);
    setResultUrl(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    timerRef.current = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);

    try {
      let input: any;
      if (model === IMAGE_MODELS.Z_IMAGE) {
        input = { prompt: prompt.trim(), aspect_ratio: aspectRatio };
      } else if (model === IMAGE_MODELS.SEEDREAM) {
        input = { prompt: prompt.trim(), image_urls: [], aspect_ratio: aspectRatio, quality: "high" };
      } else if (model === IMAGE_MODELS.FLUX2) {
        input = { prompt: prompt.trim(), input_urls: [], aspect_ratio: aspectRatio, resolution: "2K" };
      } else if (model === IMAGE_MODELS.NANO_BANANA2) {
        input = { prompt: prompt.trim(), aspect_ratio: aspectRatio, resolution: "2K" };
      } else {
        input = { prompt: prompt.trim(), aspect_ratio: aspectRatio };
      }

      const taskId = await createImageTask(model, input);
      setProgressStatus("Generating image with AI model...");

      const record = await pollTask(
        taskId,
        (rec) => {
          if (rec.state === "queuing") setProgressStatus("Queued in GPU cluster...");
          else if (rec.state === "generating") setProgressStatus("Rendering image pixels...");
        },
        controller.signal,
      );

      const url = getResultUrl(record);
      setResultUrl(url);
      toast.success("Image generated!", "Your AI image is ready to preview, save to media, or add to timeline.");
    } catch (err: any) {
      if (err.name === "AbortError") return;
      console.error("[KieAIImagePanel] Generation failed:", err);
      const msg = err instanceof KieAIError ? err.message : err?.message || "Failed to generate image";
      toast.error("Generation failed", msg);
    } finally {
      setIsGenerating(false);
      setProgressStatus("");
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const fetchResultFile = async (): Promise<File> => {
    if (!resultUrl) throw new Error("No image generated");
    const res = await fetch(resultUrl);
    if (!res.ok) throw new Error("Failed to download generated image file");
    const blob = await res.blob();
    const filename = `kieai_image_${Date.now()}.png`;
    return new File([blob], filename, { type: blob.type || "image/png" });
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
      console.error("[KieAIImagePanel] Save to media failed:", err);
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
        toast.success("Added to Timeline", "Image imported to media and placed on timeline track.");
      } else {
        toast.error("Import failed", res.error?.message || "Could not place on timeline");
      }
    } catch (err: any) {
      console.error("[KieAIImagePanel] Add to timeline failed:", err);
      toast.error("Add to timeline failed", err.message || "Unknown error");
    } finally {
      setIsAddingToTimeline(false);
    }
  };

  const handleDownload = () => {
    if (!resultUrl) return;
    const a = document.createElement("a");
    a.href = resultUrl;
    a.download = `kieai_image_${Date.now()}.png`;
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="space-y-4">
      <Card variant="green" padding={3} className="border border-primary/30 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center text-primary">
            <Sparkles size={18} aria-hidden />
          </div>
          <div>
            <Text type="body" color="primary" weight="bold" className="text-[12px]">
              AI Image Generation
            </Text>
            <Text type="supporting" color="secondary" className="text-[10px]">
              Powered by Kie.ai
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
            To generate AI images, please configure your Kie.ai API key in settings.
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

      <div className="space-y-2">
        <Text type="supporting" color="secondary" weight="bold" className="text-[10px] uppercase">
          Model
        </Text>
        <div className="grid grid-cols-2 gap-1.5">
          {MODEL_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setModel(opt.id)}
              className={`p-2 rounded-lg border text-left transition-all ${
                model === opt.id
                  ? "bg-primary/10 border-primary text-text-primary ring-1 ring-primary/40"
                  : "bg-background-tertiary border-border text-text-secondary hover:border-border-strong hover:bg-background-elevated"
              }`}
            >
              <div className="font-semibold text-[11px] text-text-primary">{opt.name}</div>
              <div className="text-[9px] text-text-muted mt-0.5 line-clamp-1">{opt.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Text type="supporting" color="secondary" weight="bold" className="text-[10px] uppercase">
          Prompt
        </Text>
        <ToolcraftTextAreaControl
          label="Prompt"
          isLabelHidden
          value={prompt}
          onChange={setPrompt}
          placeholder="A cinematic neon-lit cityscape with flying vehicles in rainy night, 8k resolution, ultra detailed..."
          rows={3}
          size="sm"
        />
      </div>

      <div className="space-y-1.5">
        <Text type="supporting" color="secondary" weight="bold" className="text-[10px] uppercase">
          Aspect Ratio
        </Text>
        <div className="flex gap-1 overflow-x-auto pb-1">
          {ASPECT_RATIOS.map((r) => (
            <Button
              key={r.value}
              label={r.label}
              variant={aspectRatio === r.value ? "primary" : "secondary"}
              size="sm"
              onClick={() => setAspectRatio(r.value)}
              className="shrink-0 text-[10px]"
            />
          ))}
        </div>
      </div>

      <Button
        label={isGenerating ? `Generating... (${elapsed}s)` : "Generate Image"}
        variant="primary"
        size="md"
        icon={isGenerating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
        disabled={isGenerating || !hasKey || !prompt.trim()}
        onClick={handleGenerate}
        className="w-full font-bold"
      />

      {isGenerating && (
        <div className="p-3 rounded-lg border border-primary/20 bg-primary/5 text-center space-y-1">
          <Loader2 size={18} className="animate-spin mx-auto text-primary" />
          <Text type="supporting" color="primary" weight="bold" className="text-[11px] block">
            {progressStatus}
          </Text>
          <Text type="supporting" color="secondary" className="text-[9px] block">
            Elapsed: {elapsed} seconds
          </Text>
        </div>
      )}

      {resultUrl && (
        <div className="space-y-3 pt-2 border-t border-border">
          <Text type="supporting" color="primary" weight="bold" className="text-[11px] block">
            Generated Image
          </Text>
          <div className="rounded-lg overflow-hidden border border-border bg-black/40 flex items-center justify-center max-h-56">
            <img src={resultUrl} alt="Generated output" className="w-full h-auto object-contain max-h-56" />
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
