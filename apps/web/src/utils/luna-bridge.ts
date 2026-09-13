export function requestAgentPromptCopy(): void {
  if (window.parent === window) return;
  window.parent.postMessage(
    { source: "luna-openreel", type: "copy-agent-prompt" },
    "*",
  );
}
