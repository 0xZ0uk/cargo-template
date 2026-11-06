"use client";

import { Banner, Button, ShimmerEffect } from "@payloadcms/ui";
import { fetchServerSentEvents, useChat } from "@tanstack/ai-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApprovalRenderer } from "./ApprovalControl";
import { useApprovalBatch } from "./approvals/useApprovalBatch";
import type { AssistantModelOption } from "./api";
import { assistantUrl, chatUrl, recordingFetch } from "./api";
import { Composer } from "./Composer";
import type { AssistantNotice } from "./errors";
import { noticeForClientError, noticeForRunError } from "./errors";
import type { MessageLike } from "./MessageView";
import { collectToolResults, MessageView } from "./MessageView";
import { chatBodyState, DOCUMENT_EXAMPLE_PROMPTS, EmptyConversation } from "./EmptyConversation";
import type { DocumentReference, DocumentReferenceInput } from "../references";
import { MESSAGE_METADATA_KEY } from "../references";
import { searchDocuments } from "./api";
import type { DocumentRef, EntitySlugs, ToolCallLike, ToolResultLike } from "./tools";
import { appliedWrites } from "./tools";

/** The text of a user message's parts. */
function userTextOf(message: MessageLike): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => (typeof part.content === "string" ? part.content : ""))
    .join("");
}

export interface ChatPanelProps {
  apiRoute: string;
  adminRoute: string;
  threadId: string;
  /** This view just created the thread (nothing stored yet): show the empty state, not placeholders. */
  isNew?: boolean;
  configured: boolean;
  /** Today's budget is used up (#68): the empty state offers no example prompts, which would be refused. */
  budgetExceeded?: boolean;
  models: AssistantModelOption[];
  model: string;
  onModelChange: (model: string) => void;
  slugs: EntitySlugs;
  hrefFor: (ref: DocumentRef) => string;
  ApprovalComponent: ApprovalRenderer;
  /** A run started or ended: the conversation list may have changed (a new title). */
  onActivity: () => void;
  /**
   * The document this conversation is about (the edit view's drawer, #69): sent with the first
   * message, which the server resolves and stores; the model is told to read it first.
   */
  context?: DocumentReference;
  /**
   * A write tool's result arrived in this view (an approved change was applied), once per call;
   * never for calls already in the transcript when it loaded.
   */
  onAppliedWrite?: (call: ToolCallLike, result: ToolResultLike) => void;
  /** `@` mentions in the composer (default on). */
  mentions?: boolean;
}

const toInput = (ref: DocumentReference): DocumentReferenceInput =>
  ref.kind === "global" ? { kind: "global", slug: ref.slug } : { kind: "collection", slug: ref.slug, id: ref.id ?? "" };

/**
 * One conversation, through `useChat` over SSE. Mount it with `key={threadId}`: the hook binds a
 * connection to one thread.
 *
 * - `persistence: true`: on mount the client hydrates the thread (`GET /chat?threadId=`), paints
 *   the stored transcript, restores pending approvals and, when a run is still going (a reload
 *   mid-reply), rejoins it (`?runId&offset=-1`, then `Last-Event-ID` on reconnects).
 * - A send is `POST /chat?threadId=` with the AG-UI body; the model goes in `forwardedProps`.
 * - Stop is `POST /chat/stop` (`cancelUrl`); closing the tab does not stop a run.
 * - The run is over when the stream ends (`isLoading`), not at the first `RUN_FINISHED`.
 */
export function ChatPanel({
  apiRoute,
  adminRoute,
  threadId,
  isNew = false,
  configured,
  budgetExceeded = false,
  models,
  model,
  onModelChange,
  slugs,
  hrefFor,
  ApprovalComponent,
  onActivity,
  context,
  onAppliedWrite,
  mentions = true,
}: ChatPanelProps) {
  const recorder = useMemo(() => recordingFetch(), []);
  const modelRef = useRef(model);
  modelRef.current = model;
  const [runNotice, setRunNotice] = useState<AssistantNotice | null>(null);
  const [draft, setDraft] = useState("");
  const [references, setReferences] = useState<DocumentReference[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);
  const onActivityRef = useRef(onActivity);
  onActivityRef.current = onActivity;

  const connection = useMemo(
    () =>
      fetchServerSentEvents(chatUrl(apiRoute, threadId), () => ({
        body: { model: modelRef.current },
        credentials: "same-origin",
        fetchClient: recorder.fetch,
        cancelUrl: assistantUrl(apiRoute, "/chat/stop"),
      })),
    [apiRoute, threadId, recorder]
  );

  const chat = useChat({
    connection,
    threadId,
    persistence: true,
    onChunk: (chunk) => {
      if (chunk.type === "RUN_STARTED") {
        setRunNotice(null);
        onActivityRef.current();
      } else if (chunk.type === "RUN_ERROR") {
        const c = chunk as { code?: string; message?: string; error?: { code?: string; message?: string } };
        setRunNotice(noticeForRunError(c.code ?? c.error?.code, c.message ?? c.error?.message));
      }
    },
  });

  const streaming = chat.isLoading;
  const wasStreaming = useRef(streaming);
  useEffect(() => {
    if (wasStreaming.current && !streaming) onActivityRef.current();
    wasStreaming.current = streaming;
  }, [streaming]);

  const messages = chat.messages as unknown as ReadonlyArray<MessageLike>;
  const body = chatBodyState({ isHydrating: chat.isHydrating, isNew, messageCount: messages.length });
  const results = useMemo(() => collectToolResults(messages), [messages]);

  // Applied writes (#69): report each new one once. Calls already in the transcript when it
  // finished loading are history, not news.
  const onAppliedWriteRef = useRef(onAppliedWrite);
  onAppliedWriteRef.current = onAppliedWrite;
  const reportedWrites = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (chat.isHydrating) return;
    const writes = appliedWrites(messages, results);
    if (!reportedWrites.current) {
      reportedWrites.current = new Set(isNew ? [] : writes.map(({ call }) => call.id));
    }
    for (const { call, result } of writes) {
      if (reportedWrites.current.has(call.id)) continue;
      reportedWrites.current.add(call.id);
      onAppliedWriteRef.current?.(call, result);
    }
  }, [chat.isHydrating, messages, results, isNew]);

  const search = useCallback((query: string, signal: AbortSignal) => searchDocuments(apiRoute, query, signal), [apiRoute]);

  const documentHref = useCallback(
    (slug: string, id: string) => (slugs.collections.has(slug) ? hrefFor({ kind: "collection", slug, id, label: id }) : undefined),
    [slugs, hrefFor]
  );
  const batch = useApprovalBatch({
    chat: chat as unknown as Parameters<typeof useApprovalBatch>[0]["chat"],
    apiRoute,
    threadId,
    lastError: recorder.lastError,
    resetError: recorder.reset,
    documentHref,
  });
  const approvals = batch.pending;
  const unbound = chat.interrupts.length - approvals.length;
  const waitingForApproval = chat.interrupts.length > 0;

  // Cards render in place of their tool call's row; approvals whose call isn't in the
  // transcript (yet) render below the messages.
  const toolCallIds = useMemo(() => {
    const ids = new Set<string>();
    for (const message of messages) {
      for (const part of message.parts) if (part.type === "tool-call" && typeof part.id === "string") ids.add(part.id);
    }
    return ids;
  }, [messages]);
  const renderToolCall = useCallback(
    (call: ToolCallLike, result: ToolResultLike | undefined) => {
      const pending = approvals.find((approval) => approval.toolCallId === call.id);
      if (pending) return <ApprovalComponent approval={pending} />;
      const sent = batch.sent(call.id, result, streaming);
      return sent ? <ApprovalComponent approval={sent} /> : undefined;
    },
    [approvals, batch, streaming, ApprovalComponent]
  );
  const unplaced = approvals.filter((approval) => !toolCallIds.has(approval.toolCallId));
  const approveAllHint =
    batch.approveAllBlocked === "loading"
      ? "Waiting for the changes to load: you can’t approve what you haven’t seen."
      : batch.approveAllBlocked === "review"
        ? "A change needs its own confirmation (its document changed, or it couldn’t be shown): review it first."
        : undefined;

  // Follow the reply while the reader is at the bottom; leave them alone once they scroll up.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, approvals.length, runNotice]);

  // A send refused before the run started (not configured, rate limited, a bad model): the text
  // goes back into the composer and its bubble leaves the transcript (the server never stored it).
  const [refused, setRefused] = useState<string | null>(null);
  useEffect(() => {
    if (refused === null) return;
    setRefused(null);
    const last = messages[messages.length - 1];
    if (last && last.role === "user" && userTextOf(last).trim() === refused) {
      chat.setMessages(chat.messages.slice(0, -1));
    }
  }, [refused, messages, chat]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    // The document of an edit view's conversation goes with its first message only: it is stored
    // there, so the model keeps seeing it in the transcript.
    const about = context && messages.length === 0 ? context : undefined;
    const mentioned = references;
    setDraft("");
    setReferences([]);
    setRunNotice(null);
    recorder.reset();
    stickToBottom.current = true;
    if (about || mentioned.length) {
      // The server resolves the addresses (`forwardedProps`) and stores its own titles; the
      // metadata here only shows the chips until the transcript is reloaded.
      await chat.sendMessage(
        {
          content: text,
          metadata: {
            [MESSAGE_METADATA_KEY]: { ...(about ? { context: about } : {}), ...(mentioned.length ? { references: mentioned } : {}) },
          },
        },
        { body: { ...(about ? { context: toInput(about) } : {}), ...(mentioned.length ? { references: mentioned.map(toInput) } : {}) } }
      );
    } else {
      await chat.sendMessage(text);
    }
    if (recorder.lastError()) {
      setDraft((current) => current || text);
      setReferences((current) => (current.length ? current : mentioned));
      setRefused(text);
    }
  }, [chat, draft, recorder, context, messages.length, references]);

  const stop = useCallback(() => {
    chat.stop();
    setRunNotice(noticeForRunError("stopped"));
  }, [chat]);

  const clientError = chat.error;
  const notice: AssistantNotice | null =
    runNotice ??
    (clientError && !batch.staleCount
      ? noticeForClientError(
          clientError,
          recorder.lastError() && { status: recorder.lastError()!.status, code: recorder.lastError()!.code }
        )
      : null);

  let disabledReason: string | undefined;
  if (!configured) disabledReason = "The assistant is not configured.";
  else if (waitingForApproval) {
    disabledReason = approvals.length > 1 ? "Answer the pending changes first." : "Approve or reject the pending change first.";
  }

  return (
    <section aria-label="Chat" className="assistant-chat">
      <div
        aria-busy={streaming || chat.isHydrating}
        aria-live="polite"
        className="assistant-chat__scroll"
        onScroll={(event) => {
          const el = event.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        ref={scrollRef}
      >
        {body === "loading" ? (
          <div className="assistant-chat__loading">
            <ShimmerEffect height={48} />
            <ShimmerEffect height={96} />
          </div>
        ) : body === "empty" ? (
          <EmptyConversation
            {...(context
              ? {
                  prompts: DOCUMENT_EXAMPLE_PROMPTS,
                  description: `Ask about “${context.title}”: what it says, what is missing, or a change to draft. The assistant reads the saved version; every change waits for your approval.`,
                }
              : {})}
            examples={configured && !budgetExceeded}
            onPick={(prompt) => {
              setDraft(prompt);
              inputRef.current?.focus();
            }}
          />
        ) : (
          <div className="assistant-chat__messages">
            {messages.map((message) => (
              <MessageView
                adminRoute={adminRoute}
                hrefFor={hrefFor}
                key={message.id}
                message={message}
                renderToolCall={renderToolCall}
                results={results}
                slugs={slugs}
              />
            ))}
            {streaming && !waitingForApproval ? (
              <p aria-label="The assistant is replying" className="assistant-typing" role="status">
                <span />
                <span />
                <span />
              </p>
            ) : null}
          </div>
        )}
        {waitingForApproval || batch.failed ? (
          <div className="assistant-chat__approvals">
            {unplaced.map((approval) => (
              <ApprovalComponent approval={approval} key={approval.id} />
            ))}
            {unbound > 0 ? (
              <Banner type="warning">The assistant is paused on something this view can’t answer.</Banner>
            ) : null}
            {approvals.length > 1 ? (
              <div aria-label="Pending changes" className="assistant-batch" role="group">
                <p className="assistant-text assistant-text--small">
                  {approvals.length} changes are waiting for you ({batch.answered} answered). Your answers are sent together,
                  once every change has one.
                </p>
                <div className="assistant-row">
                  <Button
                    buttonStyle="primary"
                    disabled={chat.resuming || Boolean(batch.approveAllBlocked) || batch.answered === approvals.length}
                    margin={false}
                    onClick={batch.approveAll}
                    tooltip={approveAllHint}
                  >
                    Approve all
                  </Button>
                  <Button
                    buttonStyle="secondary"
                    disabled={chat.resuming || batch.answered === approvals.length}
                    margin={false}
                    onClick={batch.rejectAll}
                  >
                    Reject all
                  </Button>
                </div>
              </div>
            ) : null}
            {batch.staleCount ? (
              <Banner type="warning">
                {batch.staleCount === 1 ? "A document" : `${batch.staleCount} documents`} changed after you reviewed the
                change, so nothing was sent. Review the updated change and answer again.
              </Banner>
            ) : batch.failed && approvals.length ? (
              <Banner type="danger">
                <span>Your answers could not be sent. </span>
                <Button buttonStyle="secondary" disabled={chat.resuming} margin={false} onClick={batch.retry}>
                  Send again
                </Button>
              </Banner>
            ) : null}
          </div>
        ) : null}
        {notice ? (
          <div className="assistant-chat__notice">
            <Banner type={notice.type}>{notice.message}</Banner>
          </div>
        ) : null}
      </div>
      <Composer
        disabled={!configured || waitingForApproval || body === "loading"}
        inputRef={inputRef}
        disabledReason={disabledReason}
        model={model}
        models={models}
        onChange={setDraft}
        onModelChange={onModelChange}
        onSend={() => void send()}
        onStop={stop}
        streaming={streaming}
        value={draft}
        {...(mentions ? { references, onReferencesChange: setReferences, searchDocuments: search } : {})}
      />
    </section>
  );
}
