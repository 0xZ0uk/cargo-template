"use client";

import React from "react";
import { formatUsd, type UsageResponse } from "../usage";

export interface UsageSummaryProps {
  usage: UsageResponse | null;
}

/** "HH:MM UTC" of the reset, in the viewer's locale. */
function resetTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "midnight UTC" : `${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} (midnight UTC)`;
}

/**
 * The budget line in the view's header (#68): what is left today and what this conversation has
 * cost. Nothing while loading; only the conversation's cost when budgets are off.
 */
export function UsageSummary({ usage }: UsageSummaryProps) {
  if (!usage) return null;
  const parts: string[] = [];
  const { budget, remaining } = usage;
  if (budget?.dailyCostUsd !== undefined && remaining.costUsd !== null) {
    parts.push(`${formatUsd(remaining.costUsd)} of ${formatUsd(budget.dailyCostUsd)} left today`);
  } else if (budget?.dailyTokens !== undefined && remaining.tokens !== null) {
    parts.push(`${remaining.tokens.toLocaleString()} of ${budget.dailyTokens.toLocaleString()} tokens left today`);
  } else {
    parts.push(`${formatUsd(usage.costUsd)} today`);
  }
  if (usage.conversation) parts.push(`this conversation ${formatUsd(usage.conversation.costUsd)}`);
  return (
    <p
      className={`assistant-text assistant-text--small assistant-usage${usage.exceeded ? " assistant-usage--exceeded" : " assistant-text--secondary"}`}
      title={`Resets at ${resetTime(usage.resetsAt)}`}
    >
      {parts.join(" · ")}
    </p>
  );
}
