import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { projectManager } from "./project-manager";

const storedProject = {
  id: "luna-project-1",
  name: "Luna Demo",
  createdAt: 1,
  modifiedAt: 2,
  settings: {
    width: 1920,
    height: 1080,
    frameRate: 30,
    sampleRate: 48000,
    channels: 2,
  },
  timeline: {
    duration: 0,
    tracks: [],
    markers: [],
    subtitles: [],
  },
  mediaLibrary: {
    items: [
      {
        id: "media-1",
        name: "clip.mp4",
        type: "video",
        fileHandle: null,
        blob: new Blob(["runtime data"]),
        metadata: {
          duration: 1,
          width: 1920,
          height: 1080,
          frameRate: 30,
          codec: "h264",
          sampleRate: 48000,
          channels: 2,
          fileSize: 12,
        },
        thumbnailUrl: "blob:preview",
        waveformData: new Float32Array([0.2]),
      },
    ],
  },
};

describe("ProjectManager Luna project persistence", () => {
  beforeEach(async () => {
    await projectManager.createProject();
  });

  afterEach(() => {
    delete (window as any).openreel;
  });

  it("creates a project with the Luna id when no editor document exists", async () => {
    (window as any).openreel = {
      lunaProject: {
        load: vi.fn(async () => ({
          projectId: "luna-project-1",
          projectName: "Luna Demo",
          editorDocument: null,
        })),
        save: vi.fn(),
      },
    };

    const project = await projectManager.loadLunaProject("luna-project-1");

    expect(project.id).toBe("luna-project-1");
    expect(project.name).toBe("Luna Demo");
    expect(projectManager.getCurrentLunaProjectId()).toBe("luna-project-1");
  });

  it("loads and saves the Luna document using the autosave-safe format", async () => {
    const save = vi.fn(
      async (_projectId: string, _editorDocument: string) => undefined,
    );
    (window as any).openreel = {
      lunaProject: {
        load: vi.fn(async () => ({
          projectId: storedProject.id,
          projectName: storedProject.name,
          editorDocument: JSON.stringify(storedProject),
        })),
        save,
      },
    };

    const project = await projectManager.loadLunaProject(storedProject.id);
    await projectManager.saveLunaProject(storedProject.id, project);

    expect(save).toHaveBeenCalledTimes(1);
    const serialized = JSON.parse(save.mock.calls[0][1]);
    expect(serialized.id).toBe(storedProject.id);
    expect(serialized.mediaLibrary.items[0].blob).toBeNull();
    expect(serialized.mediaLibrary.items[0].fileHandle).toBeNull();
    expect(serialized.mediaLibrary.items[0].waveformData).toBeNull();
    expect(serialized.mediaLibrary.items[0].thumbnailUrl).toBeNull();
  });
});
