import { createHash } from "node:crypto";

// Namespace of mellodifai's local prompt ids (a random v4, fixed forever: changing it would
// make a requeued job miss the prompt it already submitted).
export const PROMPT_NAMESPACE = "5b0f6f3e-2c55-4d2e-9a43-6d1c8f1b7a20";

// RFC 9562 UUID version 5 (SHA-1 of namespace and name), lowercase as ComfyUI requires.
export function uuidv5(namespace: string, name: string): string {
  const bytes = createHash("sha1")
    .update(Buffer.from(namespace.replaceAll("-", ""), "hex"))
    .update(name, "utf8")
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
