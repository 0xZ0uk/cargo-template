// Client entry (`@cargo/payload-plugin-assistant/client`): the admin UI's React components.
// tsup prepends "use client" (esbuild drops module-level directives). Nothing here may import
// Payload's server runtime, `@tanstack/ai` server code or `cloudflare:workers`.
import "./ui/assistant.css";

export { AssistantChat, type AssistantChatProps } from "./ui/AssistantChat";
export { AssistantNavLinkClient } from "./ui/AssistantNavLinkClient";
export {
  ApprovalControl,
  pendingApprovalFrom,
  type ApprovalRenderer,
  type ApprovalRendererProps,
  type PendingApproval,
} from "./ui/ApprovalControl";
