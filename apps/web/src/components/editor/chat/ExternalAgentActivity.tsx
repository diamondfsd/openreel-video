import { useEffect, type JSX } from "react";
import { Bot, Check, CircleAlert, Loader2 } from "@/icons/lucide-compat";
import { ToolcraftProgressBar } from "@openreel/ui";
import { useExternalAgentStore } from "../../../stores/external-agent-store";

const STATUS_LABELS: Record<string, string> = {
  queued: "等待 Agent",
  running: "执行中",
  completed: "已完成",
  failed: "执行失败",
  cancelled: "已取消",
};

const PHASE_LABELS: Record<string, string> = {
  waiting: "等待任务",
  analyzing_media: "分析素材",
  creating_project: "创建项目",
  importing_media: "导入素材",
  editing: "剪辑中",
  captioning: "处理字幕",
  saving: "保存项目",
  exporting: "导出成片",
  completed: "已完成",
  failed: "执行失败",
  cancelled: "已取消",
};

const TOOL_LABELS: Record<string, string> = {
  get_editing_skill: "读取剪辑能力",
  list_local_media: "浏览本地素材",
  inspect_local_media: "查看素材画面",
  transcribe_local_media: "识别语音字幕",
  create_project: "创建项目",
  list_projects: "查看项目",
  open_project: "打开项目",
  import_local_media: "导入本地素材",
  add_clip: "添加片段",
  remove_clip: "移除片段",
  trim_clip: "裁剪片段",
  split_clip: "分割片段",
  add_transition: "添加转场",
  create_text_clip: "添加文字",
  import_srt: "导入字幕",
  export_project: "导出项目",
  export_video: "导出视频",
  save_project: "保存项目",
};

function statusIcon(status: string): JSX.Element {
  if (status === "completed") return <Check size={13} />;
  if (status === "failed") return <CircleAlert size={13} />;
  return <Loader2 size={13} className={status === "running" ? "animate-spin" : ""} />;
}

function eventLabel(type: string, toolName?: string, message?: string): string {
  const label = (toolName && TOOL_LABELS[toolName]) || "执行编辑操作";
  if (type === "tool-start") return label;
  if (type === "tool-finished") return `${label} 已完成`;
  if (type === "request-updated") return "用户已更新剪辑要求";
  if (type === "session-claimed") return "外部 Agent 已开始执行";
  if (type === "result" || type === "cancelled") return message || "任务状态已更新";
  return message || "任务状态已更新";
}

export function ExternalAgentActivity(): JSX.Element | null {
  const initialize = useExternalAgentStore((state) => state.initialize);
  const available = useExternalAgentStore((state) => state.available);
  const session = useExternalAgentStore((state) => state.session);
  const events = useExternalAgentStore((state) => state.events);
  const error = useExternalAgentStore((state) => state.error);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  if (!available || !session) {
    return error ? (
      <div className="rounded-md border border-status-error/30 bg-status-error/10 px-2.5 py-2 text-[11px] text-status-error">
        {error}
      </div>
    ) : null;
  }

  const visibleEvents = events.slice(-12);
  const terminal = session.status === "completed" || session.status === "failed" || session.status === "cancelled";
  const progressVariant = session.status === "failed" ? "error" : session.status === "completed" ? "success" : "accent";

  return (
    <section
      className="space-y-2 rounded-md border border-border bg-bg-2/50 p-2.5"
      aria-label="外部 Agent 进度"
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-accent-soft text-accent">
          <Bot size={13} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-fg">
            <span>外部 Agent</span>
            <span className="text-fg-muted">·</span>
            <span className={session.status === "failed" ? "text-status-error" : session.status === "completed" ? "text-status-success" : "text-fg-muted"}>
              {STATUS_LABELS[session.status] ?? session.status}
            </span>
          </div>
          <div className="truncate text-[10px] text-fg-muted">
            {PHASE_LABELS[session.phase] ?? session.phase} · 需求 v{session.revision}
          </div>
        </div>
        <span className="shrink-0 text-fg-muted">{statusIcon(session.status)}</span>
      </div>

      <ToolcraftProgressBar
        label={session.message}
        value={session.progress}
        hasValueLabel
        isLabelHidden
        variant={progressVariant}
      />

      {session.cancelRequested && !terminal && (
        <div className="text-[10px] text-status-warning">正在停止当前任务</div>
      )}

      {visibleEvents.length > 0 && (
        <div className="max-h-32 space-y-1 overflow-y-auto border-t border-border pt-2">
          {visibleEvents.map((event) => (
            <div key={`${event.sequence}-${event.type}`} className="flex min-w-0 items-start gap-1.5 text-[10px] leading-relaxed text-fg-muted">
              <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-fg-muted/60" />
              <span className="min-w-0 break-words">
                {eventLabel(event.type, event.toolName, event.message)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
