/**
 * Re-exports from `@/lib/ai`, the single server-side AI service file.
 */
export {
  DEFAULT_MODEL,
  SYSTEM_PROMPT,
  isClaudeConfigured,
  clarifyEventDetails,
  generatePlan,
  generatePlanWithClaude,
  editPlanWithChat,
  checkPlanForGaps,
  generatePublishCopy,
  toHHMM,
  type AiFailure,
  type ClarifyResult,
  type PlannerResult,
  type ChatEditInput,
  type ChatEditResult,
  type PlanCheckInput,
  type PlanCheckResult,
  type PublishCopyInput,
  type PublishCopyResult,
} from "@/lib/ai";
