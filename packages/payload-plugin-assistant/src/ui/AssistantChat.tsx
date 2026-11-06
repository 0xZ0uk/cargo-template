"use client";

import { Banner, Button, useConfig } from "@payloadcms/ui";
import { formatAdminURL } from "payload/shared";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { ApprovalRenderer } from "./ApprovalControl";
import { ApprovalCard } from "./approvals/ApprovalCard";
import type { AssistantClientConfig, ConversationSummary } from "./api";
import {
  deleteConversation,
  fetchAssistantConfig,
  isValidThreadId,
  listConversations,
  newThreadId,
  renameConversation,
} from "./api";
import { ChatPanel } from "./ChatPanel";
import { ConversationList } from "./ConversationList";
import type { AssistantNotice } from "./errors";
import { noticeForClientError } from "./errors";
import type { DocumentRef, EntitySlugs } from "./tools";

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
const MODEL_STORAGE_KEY = "cargo-assistant:model";

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

function readStoredModel(): string | undefined {
  try {
    return window.localStorage.getItem(MODEL_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function storeModel(model: string) {
  try {
    window.localStorage.setItem(MODEL_STORAGE_KEY, model);
  } catch {
    // Private mode or blocked storage: the picker still works for this page.
  }
}

/**
 * The assistant's admin view: the conversation list and the open conversation. Talks only to
 * `/api/assistant/*` (README, "Endpoints").
 */
export function AssistantChat({
  configured: configuredProp = true,
  ApprovalComponent = ApprovalCard,
}: AssistantChatProps) {
  const { config } = useConfig();
  const apiRoute = config.routes?.api ?? "/api";
  const adminRoute = config.routes?.admin ?? "/admin";

  const [clientConfig, setClientConfig] = useState<AssistantClientConfig | null>(null);
  const [loadNotice, setLoadNotice] = useState<AssistantNotice | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listNotice, setListNotice] = useState<AssistantNotice | null>(null);
  // Read after mount (the URL isn't known while rendering on the server). A new conversation gets
  // a fresh id and exists once its first turn is sent.
  const [threadId, setThreadId] = useState<string | null>(null);
  // The thread this view minted and hasn't sent yet: there is nothing stored to load.
  const [newThread, setNewThread] = useState<string | null>(null);
  const [model, setModel] = useState<string>("");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const fromUrl = readThreadFromUrl();
    const id = fromUrl ?? newThreadId();
    setThreadId(id);
    if (!fromUrl) setNewThread(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchAssistantConfig(apiRoute)
      .then((body) => {
        if (cancelled) return;
        setClientConfig(body);
        const stored = readStoredModel();
        setModel(stored && body.models.some((m) => m.id === stored) ? stored : body.defaultModel);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadNotice(noticeForClientError(error));
      });
    return () => {
      cancelled = true;
    };
  }, [apiRoute]);

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
  }, [refreshList, threadId]);

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

  const onModelChange = useCallback((next: string) => {
    setModel(next);
    storeModel(next);
  }, []);

  const slugs: EntitySlugs = useMemo(
    () => ({
      collections: new Set((config.collections ?? []).map((c) => c.slug)),
      globals: new Set((config.globals ?? []).map((g) => g.slug)),
    }),
    [config.collections, config.globals]
  );

  const hrefFor = useCallback(
    (ref: DocumentRef) =>
      formatAdminURL({
        adminRoute,
        path:
          ref.kind === "global"
            ? `/globals/${encodeURIComponent(ref.slug)}`
            : `/collections/${encodeURIComponent(ref.slug)}/${encodeURIComponent(ref.id ?? "")}`,
      }),
    [adminRoute]
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
      </header>
      {!configured ? (
        <Banner type="warning">
          The assistant is not configured: no OpenRouter API key is set. Ask an administrator to set OPENROUTER_API_KEY.
        </Banner>
      ) : null}
      {loadNotice ? <Banner type={loadNotice.type}>{loadNotice.message}</Banner> : null}
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
