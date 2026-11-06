"use client";

import { Button } from "@payloadcms/ui";
import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import type { DocumentReference } from "../references";
import { MAX_REFERENCES, referenceKey } from "../references";
import type { AssistantModelOption } from "./api";
import type { ActiveMention } from "./mentions";
import { activeMention, applyMention } from "./mentions";
import { ReferenceChips } from "./ReferenceChips";

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
  /** Documents mentioned with `@` for the next message, shown as chips (#69). */
  references?: DocumentReference[];
  onReferencesChange?: (references: DocumentReference[]) => void;
  /** The `@` search. Without it, `@` is plain text. */
  searchDocuments?: (query: string, signal: AbortSignal) => Promise<DocumentReference[]>;
}

/** Wait this long after the last keystroke before searching. */
export const MENTION_DEBOUNCE_MS = 200;

type Results = { query: string; items: DocumentReference[]; loading: boolean; failed: boolean };

/**
 * Multi-line input. Enter sends, Shift+Enter adds a line (and Enter while an IME is composing
 * does nothing). While a run streams, Stop replaces Send.
 *
 * Mentions (#69): typing `@` opens a list of documents above the input (a combobox: the textarea
 * keeps focus, Up/Down move, Enter or Tab picks, Escape closes). Picking one replaces `@query` with
 * its title and adds a chip; the message carries the chips as references.
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
  references = [],
  onReferencesChange,
  searchDocuments,
}: ComposerProps) {
  const inputId = useId();
  const modelId = useId();
  const hintId = useId();
  const listId = useId();
  const canSend = !disabled && !streaming && value.trim().length > 0;
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const setTextarea = useCallback(
    (el: HTMLTextAreaElement | null) => {
      textarea.current = el;
      if (typeof inputRef === "function") inputRef(el);
      else if (inputRef) (inputRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
    },
    [inputRef]
  );

  const [mention, setMention] = useState<ActiveMention | undefined>();
  const [results, setResults] = useState<Results | undefined>();
  const [active, setActive] = useState(0);
  const mentions = Boolean(searchDocuments && onReferencesChange);
  const full = references.length >= MAX_REFERENCES;
  const open = Boolean(mentions && mention && !full);
  const taken = new Set(references.map(referenceKey));
  const items = (results?.items ?? []).filter((item) => !taken.has(referenceKey(item)));

  const track = (el: HTMLTextAreaElement) => setMention(mentions ? activeMention(el.value, el.selectionStart ?? el.value.length) : undefined);

  // Search after a pause in typing; a newer query aborts the older one.
  const query = open ? mention!.query : undefined;
  useEffect(() => {
    if (query === undefined || !searchDocuments) return;
    const controller = new AbortController();
    setResults((current) => ({ query, items: current?.items ?? [], loading: true, failed: false }));
    const timer = setTimeout(() => {
      searchDocuments(query, controller.signal)
        .then((found) => {
          if (!controller.signal.aborted) setResults({ query, items: found, loading: false, failed: false });
        })
        .catch(() => {
          if (!controller.signal.aborted) setResults({ query, items: [], loading: false, failed: true });
        });
    }, MENTION_DEBOUNCE_MS);
    setActive(0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, searchDocuments]);

  const close = () => {
    setMention(undefined);
    setResults(undefined);
  };

  const pick = (item: DocumentReference) => {
    const el = textarea.current;
    if (!mention) return;
    const caret = el?.selectionStart ?? value.length;
    const next = applyMention(value, mention, caret, item.title);
    onChange(next.text);
    onReferencesChange?.([...references, item]);
    close();
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(next.caret, next.caret);
    });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (open && !event.nativeEvent.isComposing) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (!items.length) return;
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActive((current) => (current + step + items.length) % items.length);
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey && items[active]) {
        event.preventDefault();
        pick(items[active]!);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        // Inside a drawer, Escape would close it too.
        event.stopPropagation();
        close();
        return;
      }
    }
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (canSend) onSend();
  };

  const optionId = (index: number) => `${listId}-option-${index}`;

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
      {mentions ? (
        <ReferenceChips
          className="assistant-composer__chips"
          onRemove={(ref) => onReferencesChange?.(references.filter((r) => referenceKey(r) !== referenceKey(ref)))}
          references={references}
        />
      ) : null}
      {open ? (
        <div className="assistant-mentions">
          <ul aria-label="Documents" className="assistant-mentions__list" id={listId} role="listbox">
            {items.map((item, index) => (
              <li
                aria-selected={index === active}
                className={`assistant-mentions__option${index === active ? " assistant-mentions__option--active" : ""}`}
                id={optionId(index)}
                key={referenceKey(item)}
                // Keep the textarea focused: pick on mousedown, before it would blur.
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(item);
                }}
                onMouseEnter={() => setActive(index)}
                role="option"
              >
                <span className="assistant-chip__kind">{item.kind === "global" ? "global" : item.slug}</span>
                <span className="assistant-mentions__title">{item.title}</span>
              </li>
            ))}
          </ul>
          {!items.length ? (
            <p className="assistant-mentions__empty assistant-text assistant-text--secondary assistant-text--small" role="status">
              {results?.failed
                ? "The search failed. Keep typing to try again."
                : !results || results.loading
                  ? "Searching…"
                  : mention!.query
                    ? `No documents match “${mention!.query}”.`
                    : "No documents to mention."}
            </p>
          ) : null}
        </div>
      ) : null}
      <textarea
        aria-activedescendant={open && items[active] ? optionId(active) : undefined}
        aria-autocomplete={mentions ? "list" : undefined}
        aria-controls={open ? listId : undefined}
        aria-describedby={disabledReason ? hintId : undefined}
        aria-expanded={mentions ? open : undefined}
        className="assistant-textarea"
        disabled={disabled && !streaming}
        id={inputId}
        onBlur={close}
        onChange={(event) => {
          onChange(event.target.value);
          track(event.target);
        }}
        onClick={(event) => track(event.currentTarget)}
        onKeyDown={onKeyDown}
        onKeyUp={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End") track(event.currentTarget);
        }}
        placeholder={mentions ? "Ask about your content… Type @ to mention a document." : "Ask about your content…"}
        ref={setTextarea}
        role={mentions ? "combobox" : undefined}
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
