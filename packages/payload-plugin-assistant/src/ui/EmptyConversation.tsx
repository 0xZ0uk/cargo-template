"use client";

import { Button } from "@payloadcms/ui";
import React from "react";

/** Starting points shown in a new conversation. Generic: they work on any site's content. */
export const EXAMPLE_PROMPTS = [
  "What content does this site have?",
  "Which documents are still drafts?",
  "What changed in the last week?",
] as const;

/** Starting points in a conversation about one document (the edit view's drawer, #69). */
export const DOCUMENT_EXAMPLE_PROMPTS = [
  "Summarise this document.",
  "Suggest a clearer title.",
  "What is missing before I publish it?",
] as const;

export interface EmptyConversationProps {
  /** An example was picked: put it in the composer (the editor can still change it before sending). */
  onPick?: (prompt: string) => void;
  /** Hide the examples (sending isn't possible: not configured). */
  examples?: boolean;
  /** Other examples (default {@link EXAMPLE_PROMPTS}). */
  prompts?: ReadonlyArray<string>;
  /** Replaces the line under the heading. */
  description?: React.ReactNode;
}

/** A conversation with no messages yet: what the assistant does, and a few prompts to start from. */
export function EmptyConversation({ onPick, examples = true, prompts = EXAMPLE_PROMPTS, description }: EmptyConversationProps) {
  return (
    <div className="assistant-chat__empty">
      <h2 className="assistant-heading">What can I help with?</h2>
      <p className="assistant-text assistant-text--secondary">
        {description ??
          "Ask about your content: find documents, check what is missing, or draft changes. Every change waits for your approval and is saved as a draft."}
      </p>
      {examples && onPick ? (
        <ul aria-label="Example questions" className="assistant-chat__examples">
          {prompts.map((prompt) => (
            <li key={prompt}>
              <Button buttonStyle="secondary" margin={false} onClick={() => onPick(prompt)} type="button">
                {prompt}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** What the transcript area shows. */
export type ChatBodyState = "loading" | "empty" | "messages";

/**
 * Placeholders only while an existing conversation loads. A conversation this view just created
 * (`isNew`: a fresh id, nothing stored) has nothing to load, so it shows the empty state at once
 * instead of placeholders until the hydration request answers (#116).
 */
export function chatBodyState({ isHydrating, isNew, messageCount }: { isHydrating: boolean; isNew: boolean; messageCount: number }): ChatBodyState {
  if (messageCount > 0) return "messages";
  return isHydrating && !isNew ? "loading" : "empty";
}
