import type { ServiceConfig } from "../../../stores/settings-store";

const SERVICE_LABELS: Record<string, string> = {
  elevenlabs: "ElevenLabs",
  "openai-compatible": "OpenAI 兼容接口",
  "anthropic-compatible": "Anthropic 兼容接口",
  "kie-ai": "Kie.ai",
  freepik: "Freepik",
};

const SERVICE_DESCRIPTIONS: Record<string, string> = {
  elevenlabs: "AI 语音生成和文本转语音",
  "openai-compatible": "任意 OpenAI 兼容 API 主机；API 密钥可选",
  "anthropic-compatible": "任意兼容 Anthropic Messages 的 API 主机；API 密钥可选",
  "kie-ai": "用于视频/图片生成、放大和编辑的 AI 聚合服务",
  freepik: "用于图片生成、矢量图和创意素材的 AI 聚合服务",
};

export function getServiceDisplayLabel(
  service: Pick<ServiceConfig, "id" | "label">,
): string {
  return SERVICE_LABELS[service.id] ?? service.label;
}

export function getServiceDisplayDescription(
  service: Pick<ServiceConfig, "id" | "description">,
): string {
  return SERVICE_DESCRIPTIONS[service.id] ?? service.description;
}
