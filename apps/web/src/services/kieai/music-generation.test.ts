import { describe, it, expect } from "vitest";
import {
  getMusicTracks,
  getMusicResultUrl,
  type TaskRecord,
} from "./music-generation";

describe("Suno Music Generation Result Parsing", () => {
  it("extracts audio URLs from nested response.sunoData", () => {
    const record: TaskRecord = {
      taskId: "task-123",
      model: "ai-music-api/generate",
      state: "success",
      createTime: "2026-10-22",
      updateTime: "2026-10-22",
      resultJson: JSON.stringify({
        response: {
          sunoData: [
            {
              id: "track-1",
              audio_url: "https://cdn.example.com/khmer_song_1.mp3",
              stream_audio_url: "https://cdn.example.com/stream_1",
              image_url: "https://cdn.example.com/cover_1.jpg",
              title: "Khmer Soul Ballad",
              duration: 198.5,
            },
            {
              id: "track-2",
              audio_url: "https://cdn.example.com/khmer_song_2.mp3",
              title: "Khmer Soul Ballad (Alt)",
              duration: 204.0,
            },
          ],
        },
      }),
    };

    const tracks = getMusicTracks(record);
    expect(tracks).toHaveLength(2);
    expect(tracks[0].audioUrl).toBe("https://cdn.example.com/khmer_song_1.mp3");
    expect(tracks[0].streamAudioUrl).toBe("https://cdn.example.com/stream_1");
    expect(tracks[0].imageUrl).toBe("https://cdn.example.com/cover_1.jpg");
    expect(tracks[0].title).toBe("Khmer Soul Ballad");
    expect(tracks[0].duration).toBe(198.5);

    expect(tracks[1].audioUrl).toBe("https://cdn.example.com/khmer_song_2.mp3");
    expect(tracks[1].title).toBe("Khmer Soul Ballad (Alt)");

    expect(getMusicResultUrl(record)).toBe("https://cdn.example.com/khmer_song_1.mp3");
  });

  it("extracts audio URLs from direct sunoData array", () => {
    const record: TaskRecord = {
      taskId: "task-456",
      model: "ai-music-api/generate",
      state: "success",
      createTime: "2026-10-22",
      updateTime: "2026-10-22",
      resultJson: JSON.stringify({
        sunoData: [
          {
            audioUrl: "https://cdn.example.com/audio_camelCase.mp3",
            title: "Pop Track",
          },
        ],
      }),
    };

    const tracks = getMusicTracks(record);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].audioUrl).toBe("https://cdn.example.com/audio_camelCase.mp3");
    expect(getMusicResultUrl(record)).toBe("https://cdn.example.com/audio_camelCase.mp3");
  });

  it("extracts audio URLs from standard resultUrls array", () => {
    const record: TaskRecord = {
      taskId: "task-789",
      model: "ai-music-api/generate",
      state: "success",
      createTime: "2026-10-22",
      updateTime: "2026-10-22",
      resultJson: JSON.stringify({
        resultUrls: ["https://cdn.example.com/generated_music.mp3"],
      }),
    };

    const tracks = getMusicTracks(record);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].audioUrl).toBe("https://cdn.example.com/generated_music.mp3");
  });

  it("handles raw string URL in resultJson", () => {
    const record: TaskRecord = {
      taskId: "task-abc",
      model: "ai-music-api/generate",
      state: "success",
      createTime: "2026-10-22",
      updateTime: "2026-10-22",
      resultJson: "https://cdn.example.com/direct_audio.mp3",
    };

    const tracks = getMusicTracks(record);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].audioUrl).toBe("https://cdn.example.com/direct_audio.mp3");
  });
});
