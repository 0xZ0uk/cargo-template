"use client";

import { Banner, ShimmerEffect } from "@payloadcms/ui";
import { fetchServerSentEvents, useChat } from "@tanstack/ai-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApprovalRenderer } from "./ApprovalControl";
import { pendingApprovalFrom } from "./ApprovalControl";
import type { AssistantModelOption } from "./api";
import { assistantUrl, chatUrl, recordingFetch } from "./api";
import { Composer } from "./Composer";
import type { AssistantNotice } from "./errors";
import { noticeForClientError, noticeForRunError } from "./errors";
import type { MessageLike } from "./MessageView";
import { collectToolResults, MessageView } from "./MessageView";
import type { DocumentRef, EntitySlugs } from "./tools";

export interface ChatPanelProps {
  apiRoute: string;
  adminRoute: string;
  threadId: string;
  configured: boolean;
  models: AssistantModelOption[];
  model: string;
  onModelChange: (model: string) => void;
  slugs: EntitySlugs;
  hrefFor: (ref: DocumentRef) => string;
  ApprovalComponent: ApprovalRenderer;
  /** A run started or ended: the conversation list may have changed (a new title). */
  onActivity: () => void;
}

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
  configured,
  models,
  model,
  onModelChange,
  slugs,
  hrefFor,
  ApprovalComponent,
  onActivity,
}: ChatPanelProps) {
  const recorder = useMemo(() => recordingFetch(), []);
  const modelRef = useRef(model);
  modelRef.current = model;
  const [runNotice, setRunNotice] = useState<AssistantNotice | null>(null);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
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
  const results = useMemo(() => collectToolResults(messages), [messages]);

  const approvals = useMemo(
    () => chat.interrupts.map((interrupt) => ({ interrupt, approval: pendingApprovalFrom(interrupt) })),
    [chat.interrupts]
  );
  const waitingForApproval = approvals.length > 0;

  // Follow the reply while the reader is at the bottom; leave them alone once they scroll up.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, approvals.length, runNotice]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    setRunNotice(null);
    recorder.reset();
    stickToBottom.current = true;
    await chat.sendMessage(text);
    // Refused before the run started (not configured, rate limited, a bad model): keep the text.
    if (recorder.lastError()) setDraft((current) => current || text);
  }, [chat, draft, recorder]);

  const stop = useCallback(() => {
    chat.stop();
    setRunNotice(noticeForRunError("stopped"));
  }, [chat]);

  const clientError = chat.error;
  const notice: AssistantNotice | null =
    runNotice ??
    (clientError
      ? noticeForClientError(
          clientError,
          recorder.lastError() && { status: recorder.lastError()!.status, code: recorder.lastError()!.code }
        )
      : null);

  let disabledReason: string | undefined;
  if (!configured) disabledReason = "The assistant is not configured.";
  else if (waitingForApproval) disabledReason = "Approve or reject the pending change first.";

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
        {chat.isHydrating ? (
          <div className="assistant-chat__loading">
            <ShimmerEffect height={48} />
            <ShimmerEffect height={96} />
          </div>
        ) : messages.length === 0 ? (
          <div className="assistant-chat__empty">
            <h2 className="assistant-heading">What can I help with?</h2>
            <p className="assistant-text assistant-text--secondary">
              Ask about your pages, posts and media: find content, check what is missing, or draft changes. Every change
              waits for your approval and is saved as a draft.
            </p>
          </div>
        ) : (
          <div className="assistant-chat__messages">
            {messages.map((message) => (
              <MessageView
                adminRoute={adminRoute}
                hrefFor={hrefFor}
                key={message.id}
                message={message}
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
        {approvals.length ? (
          <div className="assistant-chat__approvals">
            {approvals.map(({ interrupt, approval }) =>
              approval ? (
                <ApprovalComponent
                  approval={{ ...approval, canAnswer: approval.canAnswer && !chat.resuming }}
                  key={approval.id}
                />
              ) : (
                <Banner key={(interrupt as { id: string }).id} type="warning">
                  The assistant is paused on something this view can’t answer.
                </Banner>
              )
            )}
            {chat.interruptErrors.length ? (
              <Banner type="danger">The answer could not be sent. Try again.</Banner>
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
        disabled={!configured || waitingForApproval || chat.isHydrating}
        disabledReason={disabledReason}
        model={model}
        models={models}
        onChange={setDraft}
        onModelChange={onModelChange}
        onSend={() => void send()}
        onStop={stop}
        streaming={streaming}
        value={draft}
      />
    </section>
  );
}
