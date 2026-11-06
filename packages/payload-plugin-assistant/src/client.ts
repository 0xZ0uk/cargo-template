// Client entry (`@cargo/payload-plugin-assistant/client`): the admin UI's React components.
// tsup prepends "use client" (esbuild drops module-level directives). Nothing here may import
// Payload's server runtime, `@tanstack/ai` server code or `cloudflare:workers`.
import "./ui/assistant.css";

export { AssistantChat, type AssistantChatProps } from "./ui/AssistantChat";
export { AssistantNavLinkClient } from "./ui/AssistantNavLinkClient";
export {
  ApprovalControl,
  answerInterrupt,
  pendingApprovalFrom,
  type ApprovalCardStatus,
  type ApprovalDecision,
  type ApprovalRenderer,
  type ApprovalRendererProps,
  type PendingApproval,
} from "./ui/ApprovalControl";
export { ApprovalCard } from "./ui/approvals/ApprovalCard";
export type {
  ApprovalAction,
  ApprovalProposal,
  ApprovalsResponse,
  FieldChange,
  ProposalDocument,
  ProposalItem,
} from "./approvals/types";
export { AskAssistant, useDocumentRefresh, type AskAssistantProps } from "./ui/AskAssistant";
export { ReferenceChips, type ReferenceChipsProps } from "./ui/ReferenceChips";
export type { DocumentReference, DocumentReferenceInput, MessageReferences } from "./references";
