import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "../types/project";
import type { TextClip } from "../text/types";
import { titleEngine } from "../text/title-engine";

/**
 * Guards the export frame path: ExportEngine.exportVideo renders every frame
 * through VideoEngine.renderFrame, so timeline subtitles AND caption text
 * clips on the Captions track must both be painted into the encoded frame.
 */
describe("VideoEngine export rendering of subtitles/captions", () => {
  const fillText = vi.fn();
  const strokeText = vi.fn();
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    font: "",
    textAlign: "center",
    textBaseline: "middle",
    globalAlpha: 1,
    globalCompositeOperation: "source-over" as GlobalCompositeOperation,
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
    letterSpacing: "0px",
    shadowColor: "transparent",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    measureText: vi.fn(() => ({ width: 120 })),
    fillText,
    strokeText,
    setTransform: vi.fn(),
    resetTransform: vi.fn(),
    getImageData: vi.fn(() => ({
      data: new Uint8ClampedArray(4),
      width: 1,
      height: 1,
    })),
    putImageData: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    createPattern: vi.fn(() => null),
    clip: vi.fn(),
    rect: vi.fn(),
    ellipse: vi.fn(),
  };

  class MockOffscreenCanvas {
    width: number;
    height: number;
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
    }
    getContext(): typeof ctx {
      return ctx;
    }
  }

  const makeProject = (overrides?: Partial<Project>): Project =>
    ({
      id: "export-captions",
      name: "Export captions",
      settings: {
        width: 640,
        height: 360,
        frameRate: 30,
        sampleRate: 48000,
        channels: 2,
      },
      mediaLibrary: { items: [] },
      timeline: {
        tracks: [
          {
            id: "captions-track",
            type: "video",
            name: "Captions",
            role: "captions",
            clips: [],
            transitions: [],
            locked: false,
            hidden: false,
            muted: false,
            solo: false,
          },
        ],
        subtitles: [
          {
            id: "subtitle-1",
            text: "Subtitle from timeline",
            startTime: 0,
            endTime: 5,
          },
        ],
        duration: 5,
        markers: [],
      },
      textClips: [],
      ...overrides,
    }) as unknown as Project;

  const captionClip = (trackId: string): TextClip =>
    ({
      id: "caption-clip-1",
      trackId,
      startTime: 0,
      duration: 5,
      text: "Caption from captions track",
      style: {
        fontFamily: "Inter",
        fontSize: 24,
        color: "#ffffff",
        backgroundColor: "rgba(0,0,0,0.7)",
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
    }) as unknown as TextClip;

  beforeEach(() => {
    fillText.mockClear();
    strokeText.mockClear();
    vi.stubGlobal("OffscreenCanvas", MockOffscreenCanvas);
    vi.stubGlobal("self", {
      onmessage: null,
      postMessage: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({
      id: "frame",
      width: 640,
      height: 360,
      close: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    titleEngine.loadTextClips([]);
  });

  it("paints timeline subtitles into the exported frame", async () => {
    const { VideoEngine } = await import("./video-engine");
    const engine = new VideoEngine();
    Object.assign(engine as unknown as Record<string, unknown>, {
      initialized: true,
      mediabunny: {},
    });

    await engine.renderFrame(makeProject(), 1, 640, 360);

    const painted = fillText.mock.calls.map((call) => String(call[0]));
    expect(painted).toContain("Subtitle from timeline");
  });

  it("paints caption text clips from the Captions track into the exported frame", async () => {
    const { VideoEngine } = await import("./video-engine");
    const engine = new VideoEngine();
    Object.assign(engine as unknown as Record<string, unknown>, {
      initialized: true,
      mediabunny: {},
    });

    titleEngine.loadTextClips([captionClip("captions-track")]);

    await engine.renderFrame(makeProject(), 1, 640, 360);

    const painted = fillText.mock.calls.map((call) => String(call[0]));
    expect(
      painted.some((text) => text.includes("Caption from captions track")),
    ).toBe(true);
  });

  it("paints caption text clips ABOVE the video even when the Captions track is behind the video track", async () => {
    const drawOrder: string[] = [];
    fillText.mockImplementation((text: unknown) => {
      drawOrder.push(`text:${String(text)}`);
    });
    const videoBitmap = {
      id: "video-frame",
      width: 640,
      height: 360,
      close: vi.fn(),
    };
    ctx.drawImage.mockImplementation((source: unknown) => {
      if (source === videoBitmap) drawOrder.push("video");
    });
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue(videoBitmap as unknown as ImageBitmap),
    );

    const { VideoEngine } = await import("./video-engine");
    const engine = new VideoEngine();
    Object.assign(engine as unknown as Record<string, unknown>, {
      initialized: true,
      mediabunny: {},
    });
    vi.spyOn(
      engine as unknown as {
        decodeFrameWithMediaBunny: () => Promise<ImageBitmap>;
      },
      "decodeFrameWithMediaBunny",
    ).mockResolvedValue(videoBitmap as unknown as ImageBitmap);

    titleEngine.loadTextClips([captionClip("captions-track")]);

    const baseProject = makeProject({
      mediaLibrary: {
        items: [
          {
            id: "media-1",
            name: "clip.mp4",
            type: "video",
            blob: new Blob(["x"]),
            fileHandle: null,
            thumbnailUrl: null,
            waveformData: null,
            metadata: {
              width: 640,
              height: 360,
              duration: 5,
              frameRate: 30,
              codec: "h264",
              hasVideo: true,
              hasAudio: false,
              sampleRate: 48000,
              channels: 0,
              fileSize: 1,
            },
          },
        ],
      },
    });
    // Captions track sits AFTER the video track (appended by addTrack), which
    // the painter-order helper treats as the back-most layer. Project fields
    // are readonly, so rebuild the object instead of mutating the tracks array.
    const tracks = [
      {
        id: "video-track",
        type: "video",
        name: "Video",
        clips: [
          {
            id: "clip-1",
            mediaId: "media-1",
            trackId: "video-track",
            startTime: 0,
            duration: 5,
            inPoint: 0,
            outPoint: 5,
            effects: [],
            audioEffects: [],
            transform: {
              position: { x: 0.5, y: 0.5 },
              scale: { x: 1, y: 1 },
              rotation: 0,
              anchor: { x: 0.5, y: 0.5 },
              opacity: 1,
              fitMode: "cover",
            },
            volume: 1,
            keyframes: [],
          },
        ],
        transitions: [],
        locked: false,
        hidden: false,
        muted: false,
        solo: false,
      },
      {
        id: "captions-track",
        type: "video",
        name: "Captions",
        role: "captions",
        clips: [],
        transitions: [],
        locked: false,
        hidden: false,
        muted: false,
        solo: false,
      },
    ] as Project["timeline"]["tracks"];
    const project: Project = {
      ...baseProject,
      timeline: { ...baseProject.timeline, tracks },
    };

    await engine.renderFrame(project, 1, 640, 360);

    const captionIndex = drawOrder.findIndex((entry) =>
      entry.includes("Caption from captions track"),
    );
    const videoIndex = drawOrder.indexOf("video");
    expect(captionIndex).toBeGreaterThanOrEqual(0);
    expect(videoIndex).toBeGreaterThanOrEqual(0);
    // The caption must be burned in after the video so it is not covered.
    expect(captionIndex).toBeGreaterThan(videoIndex);
  });
});
