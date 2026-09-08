import type { JSX } from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { AlertTriangle } from "@/icons/lucide-compat";
import type { ToolCall } from "@openreel/agent";
import { useChatStore } from "../../../stores/chat-store";

export function InlineConfirmCard({ call }: { call: ToolCall }): JSX.Element {
  const resolveConfirm = useChatStore((s) => s.resolveConfirm);
  const argKeys = Object.keys(call.args ?? {});

  return (
    <div className="rounded-lg border border-status-warning/40 bg-status-warning/10 p-2.5 text-[12px]">
      <div className="mb-1 flex items-center gap-1.5 font-medium text-fg">
        <AlertTriangle size={13} className="text-status-warning" />
        确认操作
      </div>
      <Text type="supporting" color="secondary" className="mb-2 text-fg-2">
        助手希望运行{" "}
        <span className="font-mono text-fg">{call.name}</span>，这可能会修改项目或产生费用。
      </Text>
      {argKeys.length > 0 && (
        <pre className="mb-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-bg-2 p-1.5 font-mono text-[10px] text-fg-2">
          {JSON.stringify(call.args, null, 2)}
        </pre>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          label="批准"
          variant="primary"
          size="sm"
          onClick={() => resolveConfirm("approve")}
          className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-accent-fg hover:bg-accent/90"
        />
        <Button
          label="本轮全部批准"
          variant="secondary"
          size="sm"
          onClick={() => resolveConfirm("approve_for_turn")}
          className="rounded-md bg-bg-2 px-2.5 py-1 text-[11px] font-medium text-fg-2 hover:bg-hover"
        />
        <Button
          label="拒绝"
          variant="destructive"
          size="sm"
          onClick={() => resolveConfirm("reject")}
          className="rounded-md px-2.5 py-1 text-[11px] font-medium text-status-error hover:bg-status-error/10"
        />
      </div>
    </div>
  );
}
