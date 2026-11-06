"use client";

import { Button } from "@payloadcms/ui";
import React, { useId } from "react";
import type { AssistantModelOption } from "./api";

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  /** A run is streaming: Stop replaces Send. */
  streaming: boolean;
  /** Sending is not possible (not configured, an approval is pending, still loading). */
  disabled?: boolean;
  /** Why sending is disabled, shown under the textarea. */
  disabledReason?: string;
  models: AssistantModelOption[];
  model: string;
  onModelChange: (model: string) => void;
  /** The textarea, e.g. to focus it after an example prompt filled it in. */
  inputRef?: React.Ref<HTMLTextAreaElement>;
}

/**
 * Multi-line input. Enter sends, Shift+Enter adds a line (and Enter while an IME is composing
 * does nothing). While a run streams, Stop replaces Send.
 */
export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  streaming,
  disabled = false,
  disabledReason,
  models,
  model,
  onModelChange,
  inputRef,
}: ComposerProps) {
  const inputId = useId();
  const modelId = useId();
  const hintId = useId();
  const canSend = !disabled && !streaming && value.trim().length > 0;

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (canSend) onSend();
  };

  return (
    <form
      className="assistant-composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) onSend();
      }}
    >
      <label className="assistant-visually-hidden" htmlFor={inputId}>
        Message the assistant
      </label>
      <textarea
        aria-describedby={disabledReason ? hintId : undefined}
        className="assistant-textarea"
        disabled={disabled && !streaming}
        id={inputId}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        ref={inputRef}
        placeholder="Ask about your content…"
        rows={3}
        value={value}
      />
      <div className="assistant-composer__bar">
        {models.length > 1 ? (
          <div className="assistant-composer__model">
            <label className="assistant-visually-hidden" htmlFor={modelId}>
              Model
            </label>
            <select
              className="assistant-select"
              disabled={streaming}
              id={modelId}
              onChange={(event) => onModelChange(event.target.value)}
              value={model}
            >
              {models.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <span className="assistant-text assistant-text--secondary assistant-text--small">
            {models[0]?.label ?? ""}
          </span>
        )}
        <span
          className="assistant-composer__hint assistant-text assistant-text--tertiary assistant-text--small"
          id={hintId}
        >
          {disabledReason ?? "Enter to send, Shift+Enter for a new line"}
        </span>
        {streaming ? (
          <Button buttonStyle="secondary" margin={false} onClick={onStop} type="button">
            Stop
          </Button>
        ) : (
          <Button buttonStyle="primary" disabled={!canSend} margin={false} type="submit">
            Send
          </Button>
        )}
      </div>
    </form>
  );
}
