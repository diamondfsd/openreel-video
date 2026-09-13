import {
  executeTool,
  getTool,
  isDestructive,
  isExpensive,
  toMcpTools,
  type ToolResult,
} from "@openreel/agent";
import type { MotionComposition } from "@openreel/core";
import { getLiveEditorHost, runExclusive } from "./host-singleton";
import { useSettingsStore } from "../../stores/settings-store";
import { useMotionStore } from "../../motion/stores/motion-store";
import { useUIStore } from "../../stores/ui-store";
import { resolveMotionCreatorPreviewTime } from "../../motion/composition-selection";

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
}

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
] as const;

function localMediaToolResult(
  ok: boolean,
  summary: string,
  data?: unknown,
  error?: { code: string; message: string },
): { ok: boolean; summary: string; data?: unknown; error?: { code: string; message: string } } {
  return { ok, summary, ...(data === undefined ? {} : { data }), ...(error ? { error } : {}) };
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
    const imported = await runExclusive(async () => {
      const results = [];
      for (const mediaId of mediaIds) {
        results.push(await host.importMediaFromLocalMedia!(mediaId));
      }
      return results;
    });
    return { ok: true, result: localMediaToolResult(true, `Imported ${imported.length} local media file${imported.length === 1 ? "" : "s"}`, imported) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: true, result: localMediaToolResult(false, message, undefined, { code: "LOCAL_MEDIA_ERROR", message }) };
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
 * Runs a main-process MCP request against the live editor. listTools returns the
 * registry; callTool gates destructive/expensive tools behind the trusted-local
 * auto-allow setting, then executes against the shared LiveEditorHost.
 */
export async function handleMcpBridgeRequest(
  req: McpBridgeRequest,
): Promise<McpBridgeResponse> {
  try {
    if (req.kind === "listTools") {
      return { ok: true, result: [...toMcpTools(), ...LOCAL_MEDIA_TOOLS] };
    }
    if (req.kind === "callTool") {
      const name = req.name;
      if (!name) return { ok: false, error: "Missing tool name" };

      const localMediaResult = await handleLocalMediaTool(name, req.args ?? {});
      if (localMediaResult) return localMediaResult;

      const autoAllow = useSettingsStore.getState().mcpAutoAllowTrustedLocal;
      if (!autoAllow && (isDestructive(name) || isExpensive(name))) {
        const blocked: ToolResult = {
          ok: false,
          summary: "Confirmation required",
          error: {
            code: "CONFIRMATION_REQUIRED",
            message: `'${name}' is destructive or expensive. Enable "Trusted local — auto-allow" in Settings → MCP to permit it.`,
          },
        };
        return { ok: true, result: blocked };
      }

      const args = req.args ?? {};
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
