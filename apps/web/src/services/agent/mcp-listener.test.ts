import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  executeTool: vi.fn(),
  getTool: vi.fn(),
  requiresUserConfirmation: vi.fn((name: string) => name === "delete_media"),
  toMcpTools: vi.fn(() => [
    { name: "list_clips", description: "List", inputSchema: { type: "object" } },
  ]),
  motionState: {
    activeCompositionId: "starter",
    setActiveCompositionId: vi.fn(),
    setPlayhead: vi.fn(),
    selectLayer: vi.fn(),
  },
  setDesktopPage: vi.fn(),
  liveHost: { id: "host" } as Record<string, unknown>,
}));

vi.mock("@openreel/agent", () => ({
  executeTool: h.executeTool,
  getTool: h.getTool,
  requiresUserConfirmation: h.requiresUserConfirmation,
  toMcpTools: h.toMcpTools,
}));

vi.mock("./host-singleton", () => ({
  getLiveEditorHost: () => h.liveHost,
  runExclusive: (fn: () => Promise<unknown>) => fn(),
}));

vi.mock("../../motion/stores/motion-store", () => ({
  useMotionStore: {
    getState: () => h.motionState,
  },
}));

vi.mock("../../stores/ui-store", () => ({
  useUIStore: {
    getState: () => ({ setDesktopPage: h.setDesktopPage }),
  },
}));

import { handleMcpBridgeRequest } from "./mcp-listener";

describe("handleMcpBridgeRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.requiresUserConfirmation.mockImplementation((name) => name === "delete_media");
    h.getTool.mockReturnValue({ domain: "read" });
    h.toMcpTools.mockReturnValue([
      { name: "list_clips", description: "List", inputSchema: { type: "object" } },
    ]);
    h.motionState.activeCompositionId = "starter";
    h.motionState.setActiveCompositionId.mockClear();
    h.motionState.setPlayhead.mockClear();
    h.motionState.selectLayer.mockClear();
    h.setDesktopPage.mockClear();
  });

  it("returns the registry for listTools", async () => {
    const res = await handleMcpBridgeRequest({ callId: "c1", kind: "listTools" });
    expect(res.ok).toBe(true);
    expect(res.result).toHaveLength(8);
    expect((res.result as Array<{ name: string }>).map((tool) => tool.name)).toEqual([
      "get_editing_skill",
      "list_clips",
      "confirm_media_deletion",
      "list_local_media",
      "import_local_media",
      "inspect_local_media",
      "create_media_contact_sheet",
      "transcribe_local_media",
    ]);
    expect(h.executeTool).not.toHaveBeenCalled();
  });

  it("returns the built-in editing skill", async () => {
    const res = await handleMcpBridgeRequest({
      callId: "skill",
      kind: "callTool",
      name: "get_editing_skill",
      args: {},
    });
    expect(res.ok).toBe(true);
    expect((res.result as { data?: { skill?: string } }).data?.skill).toContain(
      "没有画面证据时禁止盲剪",
    );
  });

  it("does not invalidate the skill when the client refreshes the tool list", async () => {
    await handleMcpBridgeRequest({
      callId: "skill-before-discovery",
      kind: "callTool",
      name: "get_editing_skill",
      args: {},
    });
    await handleMcpBridgeRequest({ callId: "tools-refresh", kind: "listTools" });
    h.getTool.mockReturnValue({ readOnly: false });
    h.executeTool.mockResolvedValue({ ok: true, summary: "Changed" });

    const res = await handleMcpBridgeRequest({
      callId: "write-after-discovery",
      kind: "callTool",
      name: "update_project_settings",
      args: {},
    });

    expect(h.executeTool).toHaveBeenCalledWith(
      "update_project_settings",
      {},
      { id: "host" },
    );
    expect(res.result).toEqual({ ok: true, summary: "Changed" });
  });

  it("returns image content for local media inspection", async () => {
    const inspectLocalMedia = vi.fn(async () => ({
      mode: "overview" as const,
      maxWidth: 480,
      items: [{
        mediaId: "local-media:test.jpg",
        name: "test.jpg",
        kind: "image" as const,
        capturedAt: null,
        frames: [{ timeSec: 0, mimeType: "image/jpeg" as const, base64: "dGVzdA==" }],
      }],
    }));
    (window as unknown as { openreel?: unknown }).openreel = {
      lunaMedia: { inspectLocalMedia },
    };

    const res = await handleMcpBridgeRequest({
      callId: "inspect",
      kind: "callTool",
      name: "inspect_local_media",
      args: { mediaIds: ["local-media:test.jpg"] },
    });

    expect(res.ok).toBe(true);
    expect(inspectLocalMedia).toHaveBeenCalledWith(
      ["local-media:test.jpg"],
      { mode: "overview" },
    );
    expect(res.content).toEqual([
      expect.objectContaining({ type: "text" }),
      { type: "text", text: "素材 test.jpg (local-media:test.jpg)，frameIndex=0，frameId=local-media:test.jpg#0，时间 0s；下一张图片就是这一帧" },
      { type: "image", data: "dGVzdA==", mimeType: "image/jpeg" },
    ]);
    expect((res.result as { data?: { items?: Array<{ frames: Array<Record<string, unknown>> }> } }).data?.items?.[0]?.frames?.[0]).toEqual({
      frameIndex: 0,
      frameId: "local-media:test.jpg#0",
      mediaId: "local-media:test.jpg",
      timeSec: 0,
    });
    delete (window as Window & { openreel?: unknown }).openreel;
  });

  it("returns one contact-sheet image with explicit cell metadata", async () => {
    const createMediaContactSheet = vi.fn(async () => ({
      mode: "overview" as const,
      maxWidth: 320,
      items: [{
        mediaId: "local-media:a.jpg",
        name: "a.jpg",
        kind: "image" as const,
        capturedAt: null,
        frames: [{ timeSec: 0, mimeType: "image/jpeg" as const, base64: "ignored-frame" }],
      }],
      contactSheet: {
        mimeType: "image/jpeg" as const,
        base64: "c2hlZXQ=",
        width: 332,
        height: 194,
        columns: 1,
        rows: 1,
        cellWidth: 320,
        cellHeight: 180,
        gap: 6,
        cells: [{
          mediaId: "local-media:a.jpg",
          frameIndex: 0,
          frameId: "local-media:a.jpg#0",
          timeSec: 0,
          sheetIndex: 0,
          x: 6,
          y: 6,
          width: 320,
          height: 180,
        }],
      },
    }));
    (window as unknown as { openreel?: unknown }).openreel = {
      lunaMedia: { createMediaContactSheet },
    };

    const originalImage = globalThis.Image;
    vi.stubGlobal("Image", undefined);
    const res = await handleMcpBridgeRequest({
      callId: "contact-sheet",
      kind: "callTool",
      name: "create_media_contact_sheet",
      args: { mediaIds: ["local-media:a.jpg"], columns: 1 },
    });
    vi.stubGlobal("Image", originalImage);

    expect(res.ok).toBe(true);
    expect(createMediaContactSheet).toHaveBeenCalledWith(
      ["local-media:a.jpg"],
      { mode: "overview", columns: 1 },
    );
    expect(res.content).toHaveLength(3);
    expect(res.content?.[0]).toEqual(expect.objectContaining({ type: "text" }));
    expect(res.content?.[1]).toEqual(expect.objectContaining({
      type: "text",
      text: expect.stringContaining("#01 | a.jpg | PHOTO | 拍摄 未知 | mediaId=local-media:a.jpg | frameId=local-media:a.jpg#0"),
    }));
    expect(res.content?.[2]).toEqual({ type: "image", data: "c2hlZXQ=", mimeType: "image/jpeg" });
    expect((res.result as { data?: { items?: Array<{ frames: Array<Record<string, unknown>> }> } }).data?.items?.[0]?.frames?.[0]).toEqual({
      frameIndex: 0,
      frameId: "local-media:a.jpg#0",
      mediaId: "local-media:a.jpg",
      timeSec: 0,
      timecode: "00:00.0",
      label: "#01",
      sheetNumber: 1,
      cell: { sheetIndex: 0, x: 6, y: 6, width: 320, height: 180 },
    });
    delete (window as Window & { openreel?: unknown }).openreel;
  });

  it("returns structured retry guidance when contact-sheet rendering fails", async () => {
    const createMediaContactSheet = vi.fn(async () => {
      throw new Error("[Parsed_pad_1] Padded dimensions cannot be smaller than input dimensions.");
    });
    (window as unknown as { openreel?: unknown }).openreel = {
      lunaMedia: { createMediaContactSheet },
    };

    const res = await handleMcpBridgeRequest({
      callId: "contact-sheet-failure",
      kind: "callTool",
      name: "create_media_contact_sheet",
      args: { mediaIds: ["local-media:a.jpg"], maxWidth: 240, columns: 5 },
    });

    expect(res.ok).toBe(true);
    expect(res.result).toEqual(expect.objectContaining({
      ok: false,
      error: {
        code: "CONTACT_SHEET_RENDER_FAILED",
        message: "[Parsed_pad_1] Padded dimensions cannot be smaller than input dimensions.",
        retryable: true,
        suggestedAction: expect.stringContaining("最多重试一次"),
      },
    }));
    delete (window as Window & { openreel?: unknown }).openreel;
  });

  it("returns per-media outcomes for partial local imports", async () => {
    h.liveHost.importMediaFromLocalMedia = vi.fn()
      .mockResolvedValueOnce({ mediaId: "imported-a", name: "a.mp4", type: "video", durationSec: 2 })
      .mockRejectedValueOnce(new Error("本地素材不存在或已被移除，请重新调用 list_local_media"));

    const res = await handleMcpBridgeRequest({
      callId: "import",
      kind: "callTool",
      name: "import_local_media",
      args: { mediaIds: ["local-media:a", "local-media:missing"] },
    });

    expect(res.ok).toBe(true);
    expect(h.liveHost.importMediaFromLocalMedia).toHaveBeenCalledTimes(2);
    expect(res.result).toEqual(expect.objectContaining({
      ok: true,
      error: expect.objectContaining({ code: "PARTIAL_SUCCESS" }),
      data: expect.objectContaining({
        status: "partial",
        importedMediaIds: ["imported-a"],
        failedMediaIds: ["local-media:missing"],
        results: [
          expect.objectContaining({ mediaId: "local-media:a", ok: true }),
          expect.objectContaining({
            mediaId: "local-media:missing",
            ok: false,
            error: expect.objectContaining({ code: "LOCAL_MEDIA_NOT_FOUND" }),
          }),
        ],
      }),
    }));
    delete h.liveHost.importMediaFromLocalMedia;
  });

  it("passes time chunking options to local speech transcription", async () => {
    const transcribeLocalMedia = vi.fn(async () => ({
      mediaId: "local-media:talk.mp4",
      name: "talk.mp4",
      durationSec: 245,
      requestId: "request-1",
      language: "zh",
      requestedRange: { startSec: 0, endSec: 245 },
      chunkDurationSec: 90,
      overlapSec: 2,
      chunks: [{
        index: 0,
        startSec: 0,
        endSec: 90,
        recognitionStartSec: 0,
        recognitionEndSec: 92,
        cueCount: 1,
      }],
      cues: [{
        id: "cue-1",
        startMs: 1_000,
        endMs: 2_000,
        text: "测试",
        source: "generated" as const,
      }],
      model: { id: "model", version: "1", sha256: "hash" },
      sourceFingerprint: { size: 1, modifiedAtMs: 1 },
      performance: { modelLoadMs: 1, inferenceMs: 2, audioMs: 3, totalMs: 4 },
    }));
    (window as unknown as { openreel?: unknown }).openreel = {
      lunaMedia: { transcribeLocalMedia },
    };

    const res = await handleMcpBridgeRequest({
      callId: "transcribe",
      kind: "callTool",
      name: "transcribe_local_media",
      args: {
        mediaId: "local-media:talk.mp4",
        startSec: 3,
        endSec: 240,
        chunkDurationSec: 90,
        overlapSec: 2,
      },
    });

    expect(res.ok).toBe(true);
    expect(transcribeLocalMedia).toHaveBeenCalledWith("local-media:talk.mp4", {
      startSec: 3,
      endSec: 240,
      chunkDurationSec: 90,
      overlapSec: 2,
    });
    expect((res.result as { data?: { cues?: Array<{ startSec: number }>; chunks?: unknown[] } }).data).toEqual(
      expect.objectContaining({
        cues: [expect.objectContaining({ startSec: 1, endSec: 2 })],
        chunks: [expect.objectContaining({ recognitionEndSec: 92 })],
        overlapSec: 2,
      }),
    );
    delete (window as Window & { openreel?: unknown }).openreel;
  });

  it("executes a safe tool against the shared host", async () => {
    h.executeTool.mockResolvedValue({ ok: true, summary: "Listed" });
    const res = await handleMcpBridgeRequest({
      callId: "c2",
      kind: "callTool",
      name: "list_clips",
      args: { trackId: "t1" },
    });
    expect(res.ok).toBe(true);
    expect(res.result).toEqual({ ok: true, summary: "Listed" });
    expect(h.executeTool).toHaveBeenCalledWith("list_clips", { trackId: "t1" }, { id: "host" });
  });

  it("requires confirmation before deleting media", async () => {
    h.getTool.mockReturnValue({ domain: "project", destructive: true });
    const res = await handleMcpBridgeRequest({
      callId: "c3",
      kind: "callTool",
      name: "delete_media",
    });
    expect(res.ok).toBe(true);
    expect(h.executeTool).not.toHaveBeenCalled();
    const pending = res.result as {
      data?: { confirmationToken?: string };
      error?: { code: string };
    };
    expect(pending.error?.code).toBe(
      "CONFIRMATION_REQUIRED",
    );
    expect(pending.data?.confirmationToken).toEqual(expect.any(String));

    h.executeTool.mockResolvedValue({ ok: true, summary: "Deleted" });
    const confirmed = await handleMcpBridgeRequest({
      callId: "c3-confirm",
      kind: "callTool",
      name: "confirm_media_deletion",
      args: { confirmationToken: pending.data?.confirmationToken },
    });
    expect(confirmed.result).toEqual({ ok: true, summary: "Deleted" });
    expect(h.executeTool).toHaveBeenCalledWith("delete_media", {}, { id: "host" });
  });

  it("executes other destructive tools without a confirmation gate", async () => {
    h.getTool.mockReturnValue({ domain: "project", destructive: true });
    h.executeTool.mockResolvedValue({ ok: true, summary: "Deleted" });
    const res = await handleMcpBridgeRequest({
      callId: "c4",
      kind: "callTool",
      name: "remove_clip",
    });
    expect(res.ok).toBe(true);
    expect(h.executeTool).toHaveBeenCalled();
    expect(res.result).toEqual({ ok: true, summary: "Deleted" });
  });

  it("focuses the Motion Creator surface after successful MCP motion edits", async () => {
    h.getTool.mockReturnValue({ domain: "motion" });
    h.executeTool.mockResolvedValue({
      ok: true,
      summary: "Created 3D scene",
      data: { compositionId: "comp-agent", layerId: "layer-scene" },
    });

    const res = await handleMcpBridgeRequest({
      callId: "c-motion",
      kind: "callTool",
      name: "add_motion_3d_scene",
      args: { compositionId: "comp-agent", startTime: 1.25 },
    });

    expect(res.ok).toBe(true);
    expect(h.motionState.setActiveCompositionId).toHaveBeenCalledWith(
      "comp-agent",
    );
    expect(h.motionState.setPlayhead).toHaveBeenCalledWith(1.25);
    expect(h.motionState.selectLayer).toHaveBeenCalledWith("layer-scene");
    expect(h.setDesktopPage).toHaveBeenCalledWith("motion");
  });

  it("opens newly activated scene3d compositions on their resolved preview frame", async () => {
    h.getTool.mockReturnValue({ domain: "motion" });
    h.executeTool.mockResolvedValue({
      ok: true,
      summary: "Synced scene",
      data: {
        compositionId: "comp-scene3d",
        layerId: "layer-scene3d",
        composition: {
          id: "comp-scene3d",
          name: "Agent 3D Scene",
          width: 1920,
          height: 1080,
          frameRate: 30,
          duration: 10,
          backgroundColor: "#05070d",
          layers: [
            {
              id: "layer-scene3d",
              type: "scene3d",
              name: "Agent 3D Scene",
              startTime: 0,
              duration: 10,
              visible: true,
              locked: false,
              transform: { position: { x: 960, y: 540 }, scale: { x: 1, y: 1 } },
              keyframes: [],
              object: { kind: "sphere", radius: 1 },
            },
          ],
          assets: [],
          variables: [],
          markers: [],
          createdAt: 1,
          modifiedAt: 1,
        },
      },
    });

    const res = await handleMcpBridgeRequest({
      callId: "c-scene3d",
      kind: "callTool",
      name: "sync_creation_scene_to_motion",
      args: { sceneId: "scene-1" },
    });

    expect(res.ok).toBe(true);
    expect(h.motionState.setActiveCompositionId).toHaveBeenCalledWith(
      "comp-scene3d",
    );
    expect(h.motionState.setPlayhead).toHaveBeenCalledWith(8.5);
    expect(h.motionState.selectLayer).toHaveBeenCalledWith("layer-scene3d");
  });

  it("follows synced creation composition and layer ids from MCP edit tools", async () => {
    h.getTool.mockReturnValue({ domain: "motion" });
    h.executeTool.mockResolvedValue({
      ok: true,
      summary: "Animated object",
      data: {
        syncedCompositionId: "comp-synced-creation",
        syncedLayerId: "layer-synced-scene",
      },
    });

    const res = await handleMcpBridgeRequest({
      callId: "c-synced-edit",
      kind: "callTool",
      name: "animate_creation_object",
      args: {
        sceneId: "scene-creation",
        objectId: "object-creation",
        position: [{ time: 2.5, x: 1, y: 0, z: 0 }],
      },
    });

    expect(res.ok).toBe(true);
    expect(h.motionState.setActiveCompositionId).toHaveBeenCalledWith(
      "comp-synced-creation",
    );
    expect(h.motionState.setPlayhead).toHaveBeenCalledWith(2.5);
    expect(h.motionState.selectLayer).toHaveBeenCalledWith("layer-synced-scene");
    expect(h.setDesktopPage).toHaveBeenCalledWith("motion");
  });

  it("focuses the editor after an MCP motion insert", async () => {
    h.getTool.mockReturnValue({ domain: "motion" });
    h.executeTool.mockResolvedValue({
      ok: true,
      summary: "Inserted motion scene",
      data: { compositionId: "comp-agent", instanceId: "instance-1" },
    });

    const res = await handleMcpBridgeRequest({
      callId: "c-insert",
      kind: "callTool",
      name: "insert_motion_into_editor",
      args: { compositionId: "comp-agent", startTime: 0 },
    });

    expect(res.ok).toBe(true);
    expect(h.setDesktopPage).toHaveBeenCalledWith("edit");
    expect(h.motionState.setActiveCompositionId).toHaveBeenCalledWith(
      "comp-agent",
    );
    expect(h.motionState.setPlayhead).toHaveBeenCalledWith(0);
  });

  it("focuses the editor after a motion tool creates an inserted timeline instance", async () => {
    h.getTool.mockReturnValue({ domain: "motion" });
    h.executeTool.mockResolvedValue({
      ok: true,
      summary: "Created product cinematic",
      data: {
        compositionId: "comp-product",
        sceneLayerId: "scene-layer",
        insertedInstanceId: "instance-product",
        insertedClipId: "motion-clip-instance-product",
      },
    });

    await handleMcpBridgeRequest({
      callId: "c-product",
      kind: "callTool",
      name: "create_product_cinematic_scene",
      args: { insertIntoEditor: true },
    });

    expect(h.setDesktopPage).toHaveBeenCalledWith("edit");
    expect(h.motionState.setActiveCompositionId).toHaveBeenCalledWith(
      "comp-product",
    );
    expect(h.motionState.selectLayer).not.toHaveBeenCalled();
  });

  it("does not move Motion Creator focus for non-motion tools", async () => {
    h.getTool.mockReturnValue({ domain: "clip" });
    h.executeTool.mockResolvedValue({
      ok: true,
      summary: "Added clip",
      data: { compositionId: "comp-agent", layerId: "layer-scene" },
    });

    await handleMcpBridgeRequest({
      callId: "c-clip",
      kind: "callTool",
      name: "add_clip",
      args: { compositionId: "comp-agent" },
    });

    expect(h.motionState.setActiveCompositionId).not.toHaveBeenCalled();
    expect(h.motionState.setPlayhead).not.toHaveBeenCalled();
    expect(h.motionState.selectLayer).not.toHaveBeenCalled();
    expect(h.setDesktopPage).not.toHaveBeenCalled();
  });

  it("errors when callTool is missing a name", async () => {
    const res = await handleMcpBridgeRequest({ callId: "c5", kind: "callTool" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/name/i);
  });
});
