import { beforeEach, describe, expect, it } from "vitest";
import { useProjectStore } from "../stores/project-store";
import { useEngineStore } from "../stores/engine-store";
import type { SubtitleStyle } from "@openreel/core";

const CAPTION_STYLE: SubtitleStyle = {
  fontFamily: "Inter",
  fontSize: 24,
  color: "#ffffff",
  backgroundColor: "rgba(0, 0, 0, 0.75)",
  position: "bottom",
};

/**
 * Export reads caption data from two sources:
 *  - VideoEngine.getActiveTextClips() -> titleEngine.getAllTextClips(),
 *    filtered to clips whose track exists and is not hidden;
 *  - VideoEngine.getActiveSubtitles() -> project.timeline.subtitles.
 * Preview reads project.textClips (falling back to the engine) and
 * timeline.subtitles. These tests pin the store -> engine sync so the data
 * present at export time matches what the preview shows.
 */
describe("Export inputs for timeline subtitles/captions", () => {
  beforeEach(async () => {
    useEngineStore.getState().getTitleEngine()?.loadTextClips([]);
    useProjectStore.getState().createNewProject();
  });

  it("addSubtitle registers the caption clip on a visible Captions track in the TitleEngine export reads", async () => {
    const store = useProjectStore.getState();
    await store.addSubtitle(
      {
        id: "caption-export-1",
        text: "Export me",
        startTime: 1,
        endTime: 3,
        style: CAPTION_STYLE,
      },
      { captionSource: "srt" },
    );

    const project = useProjectStore.getState().project;
    const captionsTrack = project.timeline.tracks.find(
      (track) => track.role === "captions" || track.name === "Captions",
    );
    expect(captionsTrack).toBeDefined();

    // Exactly the filter VideoEngine.getActiveTextClips applies during export.
    const engineClips =
      useEngineStore.getState().getTitleEngine()?.getAllTextClips() ?? [];
    const exportVisibleClips = engineClips.filter((clip) =>
      project.timeline.tracks.some(
        (track) => !track.hidden && track.id === clip.trackId,
      ),
    );
    const caption = exportVisibleClips.find((clip) => clip.text === "Export me");
    expect(caption).toBeDefined();
    expect(caption?.trackId).toBe(captionsTrack!.id);

    // Preview reads project.textClips first; both sources must agree.
    expect(
      (project.textClips ?? []).some((clip) => clip.text === "Export me"),
    ).toBe(true);
  });

  it("subtitles added through the raw subtitle/add action stay in timeline.subtitles", async () => {
    const store = useProjectStore.getState();
    await store.executeAction({
      type: "subtitle/add",
      id: "action-subtitle-1",
      timestamp: Date.now(),
      params: { text: "Legacy subtitle", startTime: 0, endTime: 2 },
    });

    expect(
      useProjectStore
        .getState()
        .project.timeline.subtitles.some((sub) => sub.text === "Legacy subtitle"),
    ).toBe(true);
  });

  it("raw text/create actions are visible to the TitleEngine export reads", async () => {
    const store = useProjectStore.getState();
    const trackResult = await store.addTrack("video", undefined, {
      mode: "standard",
      role: "captions",
      name: "Captions",
    });
    expect(trackResult?.success).toBe(true);
    const trackId = useProjectStore
      .getState()
      .project.timeline.tracks.find(
        (track) => track.role === "captions" || track.name === "Captions",
      )!.id;

    await store.executeAction({
      type: "text/create",
      id: "action-text-1",
      timestamp: Date.now(),
      params: {
        clip: {
          id: "agent-caption-1",
          trackId,
          startTime: 0,
          duration: 4,
          text: "Action caption",
          style: {
            fontFamily: "Inter",
            fontSize: 24,
            color: "#ffffff",
            backgroundColor: "transparent",
            fontWeight: "bold",
            fontStyle: "normal",
            textAlign: "center",
            verticalAlign: "middle",
            opacity: 1,
          },
          transform: {
            position: { x: 0.5, y: 0.5 },
            scale: { x: 1, y: 1 },
            rotation: 0,
            anchor: { x: 0.5, y: 0.5 },
            opacity: 1,
          },
          keyframes: [],
          effects: [],
        },
      },
    });

    const project = useProjectStore.getState().project;
    expect(
      (project.textClips ?? []).some((clip) => clip.id === "agent-caption-1"),
    ).toBe(true);
    const engineClips =
      useEngineStore.getState().getTitleEngine()?.getAllTextClips() ?? [];
    expect(engineClips.some((clip) => clip.id === "agent-caption-1")).toBe(true);
  });
});
