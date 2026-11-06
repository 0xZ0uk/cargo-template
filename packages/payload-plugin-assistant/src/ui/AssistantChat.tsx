"use client";

import { Banner, Button } from "@payloadcms/ui";
import React, { useCallback, useEffect, useState } from "react";
import type { ApprovalRenderer } from "./ApprovalControl";
import { ApprovalCard } from "./approvals/ApprovalCard";
import { useAssistantAdminContext } from "./adminContext";
import type { ConversationSummary, UsageResponse } from "./api";
import {
  deleteConversation,
  fetchUsage,
  isValidThreadId,
  listConversations,
  newThreadId,
  renameConversation,
} from "./api";
import { ChatPanel } from "./ChatPanel";
import { ConversationList } from "./ConversationList";
import type { AssistantNotice } from "./errors";
import { noticeForClientError } from "./errors";
import { UsageSummary } from "./UsageSummary";

export interface AssistantChatProps {
  /** From the server: `false` when no API key is set (the config endpoint says the same). */
  configured?: boolean;
  /**
   * Renders an approval: pending, answered, then its outcome. Default: the diff card
   * (`ApprovalCard`); `ApprovalControl` is the minimal alternative.
   */
  ApprovalComponent?: ApprovalRenderer;
}

const THREAD_PARAM = "thread";

function readThreadFromUrl(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const value = new URLSearchParams(window.location.search).get(THREAD_PARAM);
  return isValidThreadId(value) ? value : undefined;
}

/** Keeps the open conversation in the URL (`?thread=`), so a reload reopens it and rejoins its run. */
function writeThreadToUrl(threadId: string | undefined) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (threadId) url.searchParams.set(THREAD_PARAM, threadId);
  else url.searchParams.delete(THREAD_PARAM);
  window.history.replaceState(window.history.state, "", url);
}

/**
 * The assistant's admin view: the conversation list and the open conversation. Talks only to
 * `/api/assistant/*` (README, "Endpoints").
 */
export function AssistantChat({
  configured: configuredProp = true,
  ApprovalComponent = ApprovalCard,
}: AssistantChatProps) {
  const { apiRoute, adminRoute, slugs, hrefFor, clientConfig, loadNotice, model, onModelChange } = useAssistantAdminContext();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listNotice, setListNotice] = useState<AssistantNotice | null>(null);
  // Read after mount (the URL isn't known while rendering on the server). A new conversation gets
  // a fresh id and exists once its first turn is sent.
  const [threadId, setThreadId] = useState<string | null>(null);
  // The thread this view minted and hasn't sent yet: there is nothing stored to load.
  const [newThread, setNewThread] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [usage, setUsage] = useState<UsageResponse | null>(null);

  useEffect(() => {
    const fromUrl = readThreadFromUrl();
    const id = fromUrl ?? newThreadId();
    setThreadId(id);
    if (!fromUrl) setNewThread(id);
  }, []);

  const refreshList = useCallback(async () => {
    try {
      setConversations(await listConversations(apiRoute));
      setListNotice(null);
    } catch (error) {
      setListNotice(noticeForClientError(error));
    } finally {
      setListLoading(false);
    }
  }, [apiRoute]);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  // The budget line (#68): today's usage and this conversation's cost. Best effort: a failure
  // only hides the line (a refused send still says why).
  const refreshUsage = useCallback(async () => {
    try {
      setUsage(await fetchUsage(apiRoute, threadId ?? undefined));
    } catch {
      setUsage(null);
    }
  }, [apiRoute, threadId]);

  useEffect(() => {
    if (threadId) void refreshUsage();
  }, [refreshUsage, threadId]);

  const selectThread = useCallback((next: string) => {
    setThreadId(next);
    writeThreadToUrl(next);
    setSidebarOpen(false);
  }, []);

  const startNew = useCallback(() => {
    const id = newThreadId();
    setThreadId(id);
    setNewThread(id);
    writeThreadToUrl(undefined);
    setSidebarOpen(false);
  }, []);

  const onActivity = useCallback(() => {
    // The first turn creates the conversation: from now on the URL names it, and reopening it loads it.
    if (threadId) writeThreadToUrl(threadId);
    setNewThread(null);
    void refreshList();
    void refreshUsage();
  }, [refreshList, refreshUsage, threadId]);

  const onRename = useCallback(
    async (id: string, title: string) => {
      setConversations((list) => list.map((c) => (c.threadId === id ? { ...c, title } : c)));
      try {
        await renameConversation(apiRoute, id, title);
      } catch (error) {
        setListNotice(noticeForClientError(error));
      }
      await refreshList();
    },
    [apiRoute, refreshList]
  );

  const onDelete = useCallback(
    async (id: string) => {
      try {
        await deleteConversation(apiRoute, id);
        setConversations((list) => list.filter((c) => c.threadId !== id));
        if (id === threadId) startNew();
      } catch (error) {
        setListNotice(noticeForClientError(error));
      }
      await refreshList();
    },
    [apiRoute, refreshList, startNew, threadId]
  );

  const configured = configuredProp && (clientConfig?.configured ?? true);
  const activeTitle = conversations.find((c) => c.threadId === threadId)?.title;

  return (
    <div className="assistant-view">
      <header className="assistant-view__header">
        <Button
          aria-controls="assistant-sidebar"
          aria-expanded={sidebarOpen}
          buttonStyle="secondary"
          className="assistant-view__toggle"
          margin={false}
          onClick={() => setSidebarOpen((open) => !open)}
        >
          Conversations
        </Button>
        <h1 className="assistant-heading assistant-heading--medium assistant-view__title">
          {activeTitle ?? "Assistant"}
        </h1>
        <UsageSummary usage={usage} />
      </header>
      {!configured ? (
        <Banner type="warning">
          The assistant is not configured: no OpenRouter API key is set. Ask an administrator to set OPENROUTER_API_KEY.
        </Banner>
      ) : null}
      {loadNotice ? <Banner type={loadNotice.type}>{loadNotice.message}</Banner> : null}
      {usage?.exceeded ? (
        <Banner type="warning">You have used today&apos;s assistant budget. It resets at midnight UTC.</Banner>
      ) : null}
      <div className="assistant-view__body">
        <div
          className={`assistant-view__sidebar${sidebarOpen ? " assistant-view__sidebar--open" : ""}`}
          id="assistant-sidebar"
        >
          {listNotice ? <Banner type={listNotice.type}>{listNotice.message}</Banner> : null}
          <ConversationList
            activeThreadId={threadId ?? ""}
            conversations={conversations}
            loading={listLoading}
            onDelete={onDelete}
            onNew={startNew}
            onRename={onRename}
            onSelect={selectThread}
          />
        </div>
        {threadId ? (
          <ChatPanel
            adminRoute={adminRoute}
            apiRoute={apiRoute}
            ApprovalComponent={ApprovalComponent}
            budgetExceeded={usage?.exceeded ?? false}
            configured={configured}
            hrefFor={hrefFor}
            isNew={threadId === newThread}
            key={threadId}
            model={model || clientConfig?.defaultModel || ""}
            models={clientConfig?.models ?? []}
            onActivity={onActivity}
            onModelChange={onModelChange}
            slugs={slugs}
            threadId={threadId}
          />
        ) : (
          <section aria-busy="true" aria-label="Chat" className="assistant-chat" />
        )}
      </div>
    </div>
  );
}
