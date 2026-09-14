import {
  executeTool,
  getTool,
  requiresUserConfirmation,
  toMcpTools,
  type ToolResult,
} from "@openreel/agent";
import type { MotionComposition } from "@openreel/core";
import { getLiveEditorHost, runExclusive } from "./host-singleton";
import { useMotionStore } from "../../motion/stores/motion-store";
import { useUIStore } from "../../stores/ui-store";
import { resolveMotionCreatorPreviewTime } from "../../motion/composition-selection";
import { LUNA_EDITING_SKILL } from "./luna-editing-skill";
import {
  annotateContactSheet,
  buildContactSheetIndexText,
  contactSheetFrameLabel,
  formatContactSheetCaptureTime,
  formatContactSheetFrameTime,
  type ContactSheetAnnotationFrame,
} from "./contact-sheet-annotation";

export interface McpBridgeRequest {
  readonly callId: string;
  readonly kind: "listTools" | "callTool";
  readonly name?: string;
  readonly args?: Record<string, unknown>;
}

export interface McpBridgeResponse {
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: string;
  readonly content?: readonly McpBridgeContent[];
}

interface McpBridgeContent {
  readonly type: "text" | "image";
  readonly text?: string;
  readonly data?: string;
  readonly mimeType?: string;
}

interface PendingMediaDeletion {
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  readonly expiresAt: number;
}

const MEDIA_DELETION_CONFIRMATION_TTL_MS = 5 * 60 * 1000;
const pendingMediaDeletions = new Map<string, PendingMediaDeletion>();
let editingSkillRead = false;

const CONFIRM_MEDIA_DELETION_TOOL = {
  name: "confirm_media_deletion",
  description:
    "Confirm a pending media-library deletion after the user explicitly approves it. Pass the confirmationToken returned by delete_media or a raw media/delete action.",
  inputSchema: {
    type: "object",
    properties: {
      confirmationToken: {
        type: "string",
        description: "Token returned by the pending deletion request.",
      },
    },
    required: ["confirmationToken"],
    additionalProperties: false,
  },
} as const;

const GET_EDITING_SKILL_TOOL = {
  name: "get_editing_skill",
  description:
    "Read Luna AI Cut's built-in editing skill. Call this before selecting media or making any edit.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
} as const;

const LOCAL_MEDIA_TOOLS = [
  {
    name: "list_local_media",
    description:
      "List image and video files in Luna AI Cut's local media library, sorted by capture time (newest first). Use this to find the user's recent outing before editing.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 500, description: "Maximum number of files to return. Defaults to 100." },
        from: { type: "string", description: "Optional ISO date/time lower bound for capture time." },
        to: { type: "string", description: "Optional ISO date/time upper bound for capture time." },
        kind: { type: "string", enum: ["image", "video"] },
      },
      additionalProperties: false,
    },
  },
  {
    name: "import_local_media",
    description:
      "Import selected files from Luna AI Cut's local media library into the currently open project. Pass mediaIds returned by list_local_media.",
    inputSchema: {
      type: "object",
      properties: {
        mediaIds: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 50,
          description: "One or more mediaIds returned by list_local_media.",
        },
      },
      required: ["mediaIds"],
      additionalProperties: false,
    },
  },
  {
    name: "inspect_local_media",
    description:
      "Inspect local images and videos with built-in low-cost representative frames. Use overview first, then detail for selected videos. The result includes MCP image content; no external dependencies are required.",
    inputSchema: {
      type: "object",
      properties: {
        mediaIds: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 50,
          description: "Media IDs returned by list_local_media.",
        },
        mode: {
          type: "string",
          enum: ["overview", "detail"],
          description: "Overview returns one representative frame; detail returns three video frames.",
        },
        maxWidth: {
          type: "integer",
          minimum: 160,
          maximum: 800,
          description: "Maximum preview width in pixels. Defaults to 480.",
        },
      },
      required: ["mediaIds"],
      additionalProperties: false,
    },
  },
  {
    name: "create_media_contact_sheet",
    description:
      "Create one labeled JPEG contact sheet from built-in representative frames for fast visual review of many local media files. Each cell shows a stable number, short media name, media type, and video time or photo capture time. The result also keeps explicit mediaId, frameId, frameIndex, timecode, and cell coordinates in data.items[].frames[].",
    inputSchema: {
      type: "object",
      properties: {
        mediaIds: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 50,
          description: "Media IDs returned by list_local_media.",
        },
        mode: {
          type: "string",
          enum: ["overview", "detail"],
          description: "Overview returns one frame per media; detail returns three video frames per media.",
        },
        maxWidth: {
          type: "integer",
          minimum: 160,
          maximum: 480,
          description: "Maximum width of each contact-sheet cell in pixels. Defaults to 320.",
        },
        columns: {
          type: "integer",
          minimum: 1,
          maximum: 6,
          description: "Number of columns in the contact sheet. Defaults to 4.",
        },
      },
      required: ["mediaIds"],
      additionalProperties: false,
    },
  },
  {
    name: "transcribe_local_media",
    description:
      "Transcribe Chinese speech from a local video with Luna's built-in speech model and return timestamped cues. Long videos are automatically processed in time chunks with overlap context so the editor stays responsive. Use this first for talking-head, interview, narration, tutorial, and dialogue edits; no external dependencies are required.",
    inputSchema: {
      type: "object",
      properties: {
        mediaId: {
          type: "string",
          description: "A video mediaId returned by list_local_media.",
        },
        startSec: {
          type: "number",
          minimum: 0,
          description: "Optional start time in the original video's timeline. Defaults to 0.",
        },
        endSec: {
          type: "number",
          exclusiveMinimum: 0,
          description: "Optional end time in the original video's timeline. Defaults to the video end.",
        },
        chunkDurationSec: {
          type: "number",
          minimum: 10,
          maximum: 900,
          description: "Logical recognition chunk length in seconds. Defaults to 120; use 60-120 for very long videos.",
        },
        overlapSec: {
          type: "number",
          minimum: 0,
          maximum: 30,
          description: "Extra recognition context before and after each chunk. Defaults to 1.5 seconds; do not cut this context twice.",
        },
      },
      required: ["mediaId"],
      additionalProperties: false,
    },
  },
] as const;

interface LocalMediaToolError {
  code: string;
  message: string;
  retryable?: boolean;
  suggestedAction?: string;
}

function localMediaToolResult(
  ok: boolean,
  summary: string,
  data?: unknown,
  error?: LocalMediaToolError,
): { ok: boolean; summary: string; data?: unknown; error?: LocalMediaToolError } {
  return { ok, summary, ...(data === undefined ? {} : { data }), ...(error ? { error } : {}) };
}

function contactSheetToolError(message: string): LocalMediaToolError {
  if (/宽度|列数|参数|width|columns/i.test(message)) {
    return {
      code: "INVALID_PARAMS",
      message,
      retryable: true,
      suggestedAction: "调整 maxWidth 或 columns 后最多重试一次；仍失败时停止当前步骤并上报失败",
    };
  }
  if (/没有可用于生成联络表的预览帧|没有可用/i.test(message)) {
    return {
      code: "CONTACT_SHEET_NO_FRAMES",
      message,
      retryable: false,
      suggestedAction: "改用 inspect_local_media 检查可用素材，或缩小 mediaIds 范围",
    };
  }
  return {
    code: "CONTACT_SHEET_RENDER_FAILED",
    message,
    retryable: true,
    suggestedAction: "调整 maxWidth 或 columns 后最多重试一次；再次失败时停止当前步骤并上报失败",
  };
}

function localMediaImportErrorCode(message: string): string {
  if (/不存在|已被移除|not found|removed/i.test(message)) return "LOCAL_MEDIA_NOT_FOUND";
  if (/only available|不可用|unavailable/i.test(message)) return "UNSUPPORTED";
  return "LOCAL_MEDIA_IMPORT_FAILED";
}

async function handleLocalMediaTool(
  name: string,
  args: Record<string, unknown>,
): Promise<McpBridgeResponse | null> {
  if (name === "list_local_media") {
    const bridge = window.openreel?.lunaMedia;
    if (typeof bridge?.listLocalMedia !== "function") {
      return { ok: true, result: localMediaToolResult(false, "Local media listing is unavailable", undefined, { code: "UNSUPPORTED", message: "本地素材查询不可用" }) };
    }
    const query: {
      limit?: number;
      from?: string;
      to?: string;
      kind?: "image" | "video";
    } = {
      ...(typeof args.limit === "number" ? { limit: args.limit } : {}),
      ...(typeof args.from === "string" ? { from: args.from } : {}),
      ...(typeof args.to === "string" ? { to: args.to } : {}),
      ...(args.kind === "image" || args.kind === "video" ? { kind: args.kind } : {}),
    };
    try {
      const media = await bridge.listLocalMedia(query);
      return { ok: true, result: localMediaToolResult(true, `Found ${media.length} local media file${media.length === 1 ? "" : "s"}`, media) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: true, result: localMediaToolResult(false, message, undefined, { code: "LOCAL_MEDIA_ERROR", message }) };
    }
  }

  if (name === "inspect_local_media") {
    const bridge = window.openreel?.lunaMedia;
    if (typeof bridge?.inspectLocalMedia !== "function") {
      return { ok: true, result: localMediaToolResult(false, "Local media inspection is unavailable", undefined, { code: "UNSUPPORTED", message: "本地素材画面分析不可用" }) };
    }
    const mediaIds = Array.isArray(args.mediaIds)
      ? args.mediaIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    if (mediaIds.length === 0) {
      return { ok: true, result: localMediaToolResult(false, "mediaIds is required", undefined, { code: "INVALID_PARAMS", message: "请传入 list_local_media 返回的 mediaIds" }) };
    }
    const mode = args.mode === "detail" ? "detail" : "overview";
    const maxWidth = typeof args.maxWidth === "number" ? args.maxWidth : undefined;
    try {
      const inspection = await bridge.inspectLocalMedia(mediaIds, { mode, ...(maxWidth === undefined ? {} : { maxWidth }) });
      const publicItems = inspection.items.map((item) => ({
        mediaId: item.mediaId,
        name: item.name,
        kind: item.kind,
        ...(item.duration === undefined ? {} : { duration: item.duration }),
        capturedAt: item.capturedAt,
        frames: item.frames.map((frame, frameIndex) => ({
          frameIndex,
          frameId: `${item.mediaId}#${frameIndex}`,
          mediaId: item.mediaId,
          timeSec: frame.timeSec,
        })),
        ...(item.error ? { error: item.error } : {}),
      }));
      const content: McpBridgeContent[] = [{
        type: "text",
        text: JSON.stringify({ mode: inspection.mode, maxWidth: inspection.maxWidth, items: publicItems }),
      }];
      for (const item of inspection.items) {
        for (const [frameIndex, frame] of item.frames.entries()) {
          content.push({
            type: "text",
            text: `素材 ${item.name} (${item.mediaId})，frameIndex=${frameIndex}，frameId=${item.mediaId}#${frameIndex}，时间 ${frame.timeSec}s；下一张图片就是这一帧`,
          });
          content.push({ type: "image", data: frame.base64, mimeType: frame.mimeType });
        }
      }
      return {
        ok: true,
        result: localMediaToolResult(true, `Inspected ${inspection.items.length} local media file${inspection.items.length === 1 ? "" : "s"}`, {
          mode: inspection.mode,
          maxWidth: inspection.maxWidth,
          items: publicItems,
        }),
        content,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: true, result: localMediaToolResult(false, message, undefined, { code: "LOCAL_MEDIA_ERROR", message }) };
    }
  }

  if (name === "create_media_contact_sheet") {
    const bridge = window.openreel?.lunaMedia;
    if (typeof bridge?.createMediaContactSheet !== "function") {
      return { ok: true, result: localMediaToolResult(false, "Contact-sheet generation is unavailable", undefined, { code: "UNSUPPORTED", message: "素材联络表不可用" }) };
    }
    const mediaIds = Array.isArray(args.mediaIds)
      ? args.mediaIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    if (mediaIds.length === 0) {
      return { ok: true, result: localMediaToolResult(false, "mediaIds is required", undefined, { code: "INVALID_PARAMS", message: "请传入 list_local_media 返回的 mediaIds" }) };
    }
    const mode = args.mode === "detail" ? "detail" : "overview";
    const maxWidth = typeof args.maxWidth === "number" ? args.maxWidth : undefined;
    const columns = typeof args.columns === "number" ? args.columns : undefined;
    try {
      const sheet = await bridge.createMediaContactSheet(mediaIds, {
        mode,
        ...(maxWidth === undefined ? {} : { maxWidth }),
        ...(columns === undefined ? {} : { columns }),
      });
      const annotationFrames: ContactSheetAnnotationFrame[] = sheet.items.flatMap((item) => item.frames.map((frame, frameIndex) => ({
        mediaId: item.mediaId,
        frameIndex,
        frameId: `${item.mediaId}#${frameIndex}`,
        timeSec: frame.timeSec,
        name: item.name,
        kind: item.kind,
        capturedAt: item.capturedAt,
        base64: frame.base64,
      })));
      const annotatedSheet = await annotateContactSheet(sheet.contactSheet, annotationFrames);
      const cellsByFrameId = new Map(sheet.contactSheet.cells.map((cell) => [cell.frameId, cell]));
      const publicItems = sheet.items.map((item) => ({
        mediaId: item.mediaId,
        name: item.name,
        kind: item.kind,
        ...(item.duration === undefined ? {} : { duration: item.duration }),
        capturedAt: item.capturedAt,
        frames: item.frames.map((frame, frameIndex) => {
          const frameId = `${item.mediaId}#${frameIndex}`;
          const cell = cellsByFrameId.get(frameId);
          return {
            frameIndex,
            frameId,
            mediaId: item.mediaId,
            timeSec: frame.timeSec,
            timecode: formatContactSheetFrameTime(frame.timeSec),
            ...(cell ? { label: contactSheetFrameLabel(cell.sheetIndex), sheetNumber: cell.sheetIndex + 1 } : {}),
            ...(item.kind === "image" && item.capturedAt ? { captureTime: formatContactSheetCaptureTime(item.capturedAt) } : {}),
            ...(cell ? { cell: { sheetIndex: cell.sheetIndex, x: cell.x, y: cell.y, width: cell.width, height: cell.height } } : {}),
          };
        }),
        ...(item.error ? { error: item.error } : {}),
      }));
      const { base64: _base64, ...contactSheetMetadata } = sheet.contactSheet;
      const data = {
        mode: sheet.mode,
        maxWidth: sheet.maxWidth,
        items: publicItems,
        contactSheet: { ...contactSheetMetadata, labeled: annotatedSheet.labeled },
      };
      return {
        ok: true,
        result: localMediaToolResult(true, `Created a labeled contact sheet for ${sheet.items.length} local media file${sheet.items.length === 1 ? "" : "s"}`, data),
        content: [
          { type: "text", text: JSON.stringify(data) },
          { type: "text", text: buildContactSheetIndexText(annotationFrames, sheet.contactSheet.cells) },
          { type: "image", data: annotatedSheet.base64, mimeType: sheet.contactSheet.mimeType },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: true, result: localMediaToolResult(false, message, undefined, contactSheetToolError(message)) };
    }
  }

  if (name === "transcribe_local_media") {
    const bridge = window.openreel?.lunaMedia;
    if (typeof bridge?.transcribeLocalMedia !== "function") {
      return { ok: true, result: localMediaToolResult(false, "Local speech transcription is unavailable", undefined, { code: "UNSUPPORTED", message: "本地语音识别不可用" }) };
    }
    const mediaId = typeof args.mediaId === "string" ? args.mediaId.trim() : "";
    if (!mediaId) {
      return { ok: true, result: localMediaToolResult(false, "mediaId is required", undefined, { code: "INVALID_PARAMS", message: "请传入 list_local_media 返回的视频 mediaId" }) };
    }
    const transcriptionOptions = {
      ...(typeof args.startSec === "number" ? { startSec: args.startSec } : {}),
      ...(typeof args.endSec === "number" ? { endSec: args.endSec } : {}),
      ...(typeof args.chunkDurationSec === "number" ? { chunkDurationSec: args.chunkDurationSec } : {}),
      ...(typeof args.overlapSec === "number" ? { overlapSec: args.overlapSec } : {}),
    };
    try {
      const transcript = await bridge.transcribeLocalMedia(mediaId, transcriptionOptions);
      const cues = transcript.cues.map((cue) => ({
        id: cue.id,
        startMs: cue.startMs,
        endMs: cue.endMs,
        startSec: Number((cue.startMs / 1_000).toFixed(3)),
        endSec: Number((cue.endMs / 1_000).toFixed(3)),
        text: cue.text,
        source: cue.source,
      }));
      return {
        ok: true,
        result: localMediaToolResult(true, `Transcribed ${cues.length} speech cue${cues.length === 1 ? "" : "s"} in ${transcript.chunks.length} chunk${transcript.chunks.length === 1 ? "" : "s"}`, {
          mediaId: transcript.mediaId,
          name: transcript.name,
          durationSec: transcript.durationSec,
          requestedRange: transcript.requestedRange,
          chunkDurationSec: transcript.chunkDurationSec,
          overlapSec: transcript.overlapSec,
          chunks: transcript.chunks,
          language: transcript.language,
          cues,
          model: transcript.model,
          sourceFingerprint: transcript.sourceFingerprint,
        }),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: true, result: localMediaToolResult(false, message, undefined, { code: "LOCAL_MEDIA_ERROR", message }) };
    }
  }

  if (name !== "import_local_media") return null;
  const mediaIds = Array.isArray(args.mediaIds)
    ? args.mediaIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  if (mediaIds.length === 0) {
    return { ok: true, result: localMediaToolResult(false, "mediaIds is required", undefined, { code: "INVALID_PARAMS", message: "请传入 list_local_media 返回的 mediaIds" }) };
  }
  if (mediaIds.length > 50) {
    return { ok: true, result: localMediaToolResult(false, "Too many mediaIds", undefined, { code: "INVALID_PARAMS", message: "一次最多导入 50 个素材" }) };
  }
  const host = getLiveEditorHost();
  if (typeof host.importMediaFromLocalMedia !== "function") {
    return { ok: true, result: localMediaToolResult(false, "Local media import is unavailable", undefined, { code: "UNSUPPORTED", message: "本地素材导入不可用" }) };
  }
  try {
    const outcomes = await runExclusive(async () => {
      const results: Array<{
        mediaId: string;
        ok: true;
        imported: Awaited<ReturnType<NonNullable<typeof host.importMediaFromLocalMedia>>>;
      } | {
        mediaId: string;
        ok: false;
        error: { code: string; message: string };
      }> = [];
      for (const mediaId of mediaIds) {
        try {
          const imported = await host.importMediaFromLocalMedia!(mediaId);
          results.push({ mediaId, ok: true, imported });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          results.push({
            mediaId,
            ok: false,
            error: { code: localMediaImportErrorCode(message), message },
          });
        }
      }
      return results;
    });

    const succeeded = outcomes.filter((outcome): outcome is Extract<typeof outcome, { ok: true }> => outcome.ok);
    const failed = outcomes.filter((outcome): outcome is Extract<typeof outcome, { ok: false }> => !outcome.ok);
    const status = failed.length === 0 ? "completed" : succeeded.length > 0 ? "partial" : "failed";
    const summary = status === "completed"
      ? `Imported ${succeeded.length} local media file${succeeded.length === 1 ? "" : "s"}`
      : `Imported ${succeeded.length} of ${outcomes.length} local media files`;
    return {
      ok: true,
      result: localMediaToolResult(
        status !== "failed",
        summary,
        {
          status,
          requestedMediaIds: mediaIds,
          importedMediaIds: succeeded.map((outcome) => outcome.imported.mediaId),
          failedMediaIds: failed.map((outcome) => outcome.mediaId),
          results: outcomes,
        },
        failed.length > 0
          ? {
            code: status === "partial" ? "PARTIAL_SUCCESS" : failed[0]?.error.code ?? "LOCAL_MEDIA_IMPORT_FAILED",
            message: status === "partial"
              ? "部分素材导入成功，请根据 results 和 importedMediaIds 继续，不要重复导入已成功素材"
              : failed[0]?.error.message ?? "本地素材导入失败",
          }
          : undefined,
      ),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: true, result: localMediaToolResult(false, message, undefined, { code: "LOCAL_MEDIA_ERROR", message }) };
  }
}

function newConfirmationToken(): string {
  return globalThis.crypto?.randomUUID?.() ?? `media-delete-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function prunePendingMediaDeletions(now = Date.now()): void {
  for (const [token, pending] of pendingMediaDeletions) {
    if (pending.expiresAt <= now) pendingMediaDeletions.delete(token);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function firstKeyframeTime(value: unknown): number | null {
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    const time = optionalNumber(asRecord(item)?.time);
    if (time !== null) return time;
  }
  return null;
}

function getResultDataRecord(result: ToolResult): Record<string, unknown> | null {
  return asRecord(result.data);
}

function getMotionCompositionId(
  args: Record<string, unknown>,
  result: ToolResult,
): string | null {
  const data = getResultDataRecord(result);
  const composition = asRecord(data?.composition);
  const syncedCompositionIds = data?.syncedCompositionIds;
  return (
    optionalString(data?.compositionId) ??
    optionalString(data?.syncedCompositionId) ??
    optionalString(composition?.id) ??
    (Array.isArray(syncedCompositionIds)
      ? optionalString(syncedCompositionIds[0])
      : null) ??
    optionalString(args.compositionId)
  );
}

function getMotionComposition(result: ToolResult): MotionComposition | null {
  const composition = asRecord(getResultDataRecord(result)?.composition);
  if (
    !composition ||
    !optionalString(composition.id) ||
    !optionalNumber(composition.duration) ||
    !Array.isArray(composition.layers)
  ) {
    return null;
  }
  return composition as unknown as MotionComposition;
}

function getMotionFocusTime(args: Record<string, unknown>): number | null {
  return (
    optionalNumber(args.timeSeconds) ??
    optionalNumber(args.startTime) ??
    firstKeyframeTime(args.position) ??
    firstKeyframeTime(args.rotation) ??
    firstKeyframeTime(args.scale) ??
    firstKeyframeTime(args.opacity) ??
    firstKeyframeTime(args.lidAngle) ??
    firstKeyframeTime(args.target) ??
    firstKeyframeTime(args.fov)
  );
}

function getMotionLayerId(result: ToolResult): string | null {
  const data = getResultDataRecord(result);
  const layerIds = data?.layerIds;
  const createdLayerIds = data?.createdLayerIds;
  if (Array.isArray(createdLayerIds)) {
    return optionalString(createdLayerIds[0]);
  }
  if (Array.isArray(layerIds)) {
    return optionalString(layerIds[0]);
  }
  const keyedLayerIds = asRecord(layerIds);
  return (
    optionalString(data?.layerId) ??
    optionalString(data?.syncedLayerId) ??
    optionalString(data?.groupId) ??
    optionalString(keyedLayerIds ? Object.values(keyedLayerIds)[0] : undefined)
  );
}

function insertedMotionIntoEditor(
  name: string,
  args: Record<string, unknown>,
  result: ToolResult,
): boolean {
  if (name === "insert_motion_into_editor") return true;
  const data = getResultDataRecord(result);
  return (
    optionalString(data?.insertedInstanceId) !== null ||
    optionalString(data?.insertedClipId) !== null ||
    (args.insertIntoEditor === true && optionalString(data?.instanceId) !== null)
  );
}

function followMcpMotionResult(
  name: string,
  args: Record<string, unknown>,
  result: ToolResult,
): void {
  if (!result.ok || getTool(name)?.domain !== "motion") return;
  const compositionId = getMotionCompositionId(args, result);
  if (!compositionId) return;

  useUIStore
    .getState()
    .setDesktopPage(insertedMotionIntoEditor(name, args, result) ? "edit" : "motion");

  const motion = useMotionStore.getState();
  const activeChanged = motion.activeCompositionId !== compositionId;
  if (motion.activeCompositionId !== compositionId) {
    motion.setActiveCompositionId(compositionId);
  }

  const focusTime = getMotionFocusTime(args);
  if (focusTime !== null) {
    motion.setPlayhead(Math.max(0, focusTime));
  } else if (activeChanged) {
    const composition = getMotionComposition(result);
    if (composition) {
      motion.setPlayhead(resolveMotionCreatorPreviewTime(composition));
    }
  }

  const layerId = getMotionLayerId(result);
  if (layerId) {
    motion.selectLayer(layerId);
  }
}

/**
 * Runs a main-process MCP request against the live editor. Every MCP client
 * uses the same live host and can execute the complete editor tool catalog.
 */
export async function handleMcpBridgeRequest(
  req: McpBridgeRequest,
): Promise<McpBridgeResponse> {
  try {
    if (req.kind === "listTools") {
      editingSkillRead = false;
      return {
        ok: true,
        result: [GET_EDITING_SKILL_TOOL, ...toMcpTools(), CONFIRM_MEDIA_DELETION_TOOL, ...LOCAL_MEDIA_TOOLS],
      };
    }
    if (req.kind === "callTool") {
      const name = req.name;
      if (!name) return { ok: false, error: "Missing tool name" };

      if (name === "get_editing_skill") {
        editingSkillRead = true;
        return {
          ok: true,
          result: localMediaToolResult(true, "Luna editing skill loaded", {
            name: "luna-ai-cut-editing",
            version: "1.0",
            skill: LUNA_EDITING_SKILL,
          }),
        };
      }

      const registeredTool = getTool(name);
      const requiresEditingSkill = name === "import_local_media"
        || registeredTool?.readOnly === false;
      if (requiresEditingSkill && !editingSkillRead) {
        return {
          ok: true,
          result: {
            ok: false,
            summary: "请先读取 Luna 剪辑 skill",
            error: {
              code: "SKILL_REQUIRED",
              message: "调用 get_editing_skill 后才能创建项目或修改项目",
            },
          } satisfies ToolResult,
        };
      }

      const localMediaResult = await handleLocalMediaTool(name, req.args ?? {});
      if (localMediaResult) return localMediaResult;

      const args = req.args ?? {};
      if (name === "confirm_media_deletion") {
        prunePendingMediaDeletions();
        const token = typeof args.confirmationToken === "string"
          ? args.confirmationToken
          : "";
        const pending = token ? pendingMediaDeletions.get(token) : undefined;
        if (!pending) {
          return {
            ok: true,
            result: {
              ok: false,
              summary: "删除确认已失效",
              error: {
                code: "CONFIRMATION_NOT_FOUND",
                message: "删除确认不存在或已过期，请重新发起删除请求",
              },
            } satisfies ToolResult,
          };
        }
        pendingMediaDeletions.delete(token);
        const result = await runExclusive(() =>
          Promise.resolve(executeTool(pending.toolName, pending.args, getLiveEditorHost())),
        );
        followMcpMotionResult(pending.toolName, pending.args, result);
        return { ok: true, result };
      }

      if (requiresUserConfirmation(name, args)) {
        prunePendingMediaDeletions();
        const confirmationToken = newConfirmationToken();
        pendingMediaDeletions.set(confirmationToken, {
          toolName: name,
          args: { ...args },
          expiresAt: Date.now() + MEDIA_DELETION_CONFIRMATION_TTL_MS,
        });
        const blocked: ToolResult = {
          ok: false,
          summary: "需要确认删除素材",
          data: { confirmationToken },
          error: {
            code: "CONFIRMATION_REQUIRED",
            message: "请先取得用户确认，再调用 confirm_media_deletion 完成删除",
          },
        };
        return { ok: true, result: blocked };
      }

      const result = await runExclusive(() =>
        Promise.resolve(executeTool(name, args, getLiveEditorHost())),
      );
      followMcpMotionResult(name, args, result);
      return { ok: true, result };
    }
    return { ok: false, error: `Unknown MCP bridge kind: ${req.kind}` };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Installs the desktop MCP bridge listener. No-op off desktop. */
export function installMcpListener(): () => void {
  const mcp = window.openreel?.mcp;
  if (!mcp) return () => {};
  return mcp.onRequest(handleMcpBridgeRequest);
}
