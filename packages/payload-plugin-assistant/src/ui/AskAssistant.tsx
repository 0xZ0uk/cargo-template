"use client";

import {
  Banner,
  Button,
  ConfirmationModal,
  Drawer,
  toast,
  useDocumentInfo,
  useDocumentTitle,
  useEditDepth,
  useForm,
  useFormModified,
  useLocale,
  useModal,
} from "@payloadcms/ui";
import { formatAdminURL } from "payload/shared";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DocumentReference } from "../references";
import { VIEW_PATH } from "../constants";
import { useAssistantAdminContext } from "./adminContext";
import type { ApprovalRenderer } from "./ApprovalControl";
import { ApprovalCard } from "./approvals/ApprovalCard";
import { fetchSavedDocument, newThreadId } from "./api";
import { ChatPanel } from "./ChatPanel";
import type { ToolCallLike, ToolResultLike } from "./tools";
import { writeTouches } from "./tools";

export interface AskAssistantProps {
  kind: "collection" | "global";
  slug: string;
  /** Renders an approval in the drawer (default: the diff card). */
  ApprovalComponent?: ApprovalRenderer;
}

/**
 * "Ask the assistant" in a document's edit view (#69): a button in the document controls that
 * opens the chat in a Payload `Drawer`, in a new conversation about this document. Rendered by the
 * server `AssistantDocumentControls` after `access` admitted the user; hidden on a collection's
 * create view (nothing saved yet).
 */
export function AskAssistant({ kind, slug, ApprovalComponent = ApprovalCard }: AskAssistantProps) {
  const { id } = useDocumentInfo();
  if (kind === "collection" && (id === undefined || id === null || id === "")) return null;
  return <AskAssistantControls ApprovalComponent={ApprovalComponent} id={kind === "collection" ? String(id) : undefined} kind={kind} slug={slug} />;
}

type Target = { kind: "collection" | "global"; slug: string; id?: string };

/**
 * Keeps the edit view in step with the assistant (#69). When an applied write changed this
 * document: an unmodified form reloads (the saved draft, as the edit view loads it, through
 * `useForm().reset(doc)`, which rebuilds the form state on the server and clears `modified`; the
 * document info gets the new data too, so Payload's stale-data check doesn't flag the assistant's
 * save). A modified form asks first: reload and lose the edits, or keep editing, after which a
 * banner warns that saving will overwrite the assistant's change (until the form is saved).
 */
export function useDocumentRefresh(target: Target, apiRoute: string) {
  const form = useForm();
  const modified = useFormModified();
  const { setData } = useDocumentInfo();
  const locale = useLocale();
  const { openModal } = useModal();
  const confirmSlug = `assistant-reload-${target.kind}-${target.slug}`;
  const [keptEdits, setKeptEdits] = useState(false);
  const modifiedRef = useRef(modified);
  modifiedRef.current = modified;

  const reload = useCallback(async () => {
    try {
      const doc = await fetchSavedDocument(apiRoute, target, locale?.code);
      // The document info first: a new `data` re-renders the edit view; the form state last.
      setData?.(doc);
      await form.reset(doc);
      setKeptEdits(false);
      toast.success("Reloaded with the assistant’s change.");
    } catch {
      toast.error("The document could not be reloaded. Reload the page to see the assistant’s change.");
    }
  }, [apiRoute, target, locale?.code, form, setData]);

  const onDocumentChanged = useCallback(() => {
    if (!modifiedRef.current) {
      void reload();
      return;
    }
    // Closing the dialog without an answer counts as "keep editing": the banner stays until a save.
    setKeptEdits(true);
    openModal(confirmSlug);
  }, [reload, openModal, confirmSlug]);

  // Saved (or reloaded) since: the edits no longer stand against the assistant's change.
  useEffect(() => {
    if (!modified) setKeptEdits(false);
  }, [modified]);

  return { onDocumentChanged, reload, confirmSlug, overwriteWarning: keptEdits && modified };
}

function OverwriteBanner({ onReload }: { onReload: () => void }) {
  return (
    <Banner type="danger">
      <span>
        The assistant changed this document after your unsaved edits. Saving will overwrite its change.{" "}
      </span>
      <Button buttonStyle="secondary" margin={false} onClick={onReload}>
        Reload with its change
      </Button>
    </Banner>
  );
}

function AskAssistantControls({ kind, slug, id, ApprovalComponent }: Required<Pick<AskAssistantProps, "kind" | "slug" | "ApprovalComponent">> & { id: string | undefined }) {
  const admin = useAssistantAdminContext();
  const { title } = useDocumentTitle();
  const { openModal, closeModal } = useModal();
  const depth = useEditDepth();
  const drawerSlug = `assistant-${kind}-${slug}-${depth}`;
  const [threadId, setThreadId] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const target = useMemo<Target>(() => ({ kind, slug, ...(id ? { id } : {}) }), [kind, slug, id]);
  const refresh = useDocumentRefresh(target, admin.apiRoute);

  const context = useMemo<DocumentReference>(
    () => ({ ...target, title: (typeof title === "string" && title.trim()) || id || slug }),
    [target, title, id, slug]
  );

  // A new conversation the first time; reopening the drawer goes back to it until "New conversation".
  const open = () => {
    if (!threadId) setThreadId(newThreadId());
    openModal(drawerSlug);
  };
  const startNew = () => {
    setThreadId(newThreadId());
    setStarted(false);
  };

  const onAppliedWrite = useCallback(
    (call: ToolCallLike, result: ToolResultLike) => {
      if (writeTouches(call, result, target)) refresh.onDocumentChanged();
    },
    [target, refresh]
  );

  const configured = admin.clientConfig?.configured ?? true;
  const viewHref = threadId
    ? `${formatAdminURL({ adminRoute: admin.adminRoute, path: VIEW_PATH })}?thread=${encodeURIComponent(threadId)}`
    : undefined;

  return (
    <>
      <Button
        buttonStyle="secondary"
        extraButtonProps={{ style: { whiteSpace: "nowrap", flexShrink: 0 }, "data-testid": "assistant-ask" }}
        margin={false}
        onClick={open}
        size="medium"
      >
        Ask the assistant
      </Button>
      {refresh.overwriteWarning ? (
        <div className="assistant-overwrite">
          <OverwriteBanner onReload={() => openModal(refresh.confirmSlug)} />
        </div>
      ) : null}
      <ConfirmationModal
        body="You have unsaved edits. Reload the document with the assistant’s change and lose them, or keep editing (saving then overwrites the assistant’s change)."
        cancelLabel="Keep editing"
        confirmLabel="Reload and lose my edits"
        heading="The assistant changed this document"
        modalSlug={refresh.confirmSlug}
        // After the dialog has closed: reloading while it is open lost the reload (the form came
        // back with the values it was first rendered with).
        onConfirm={() => {
          setTimeout(() => void refresh.reload(), 0);
        }}
      />
      <Drawer
        className="assistant-drawer"
        headerActions={[
          ...(started ? [{ label: "New conversation", onClick: startNew, style: "secondary" as const }] : []),
        ]}
        slug={drawerSlug}
        title="Assistant"
      >
        {/* The drawer is portalled out of the document's <form>, but React events still bubble to
            it: the composer's submit must not reach the document form's onSubmit (a save). */}
        <div className="assistant-drawer__body" onSubmit={(event) => event.stopPropagation()}>
          <div className="assistant-drawer__meta">
            <p className="assistant-text assistant-text--secondary assistant-text--small">
              About <strong>{context.title}</strong>. The assistant reads the saved version, not unsaved edits.
            </p>
            {viewHref && started ? (
              <a className="assistant-link assistant-text--small" href={viewHref} onClick={() => closeModal(drawerSlug)}>
                Open in the assistant
              </a>
            ) : null}
          </div>
          {!configured ? (
            <Banner type="warning">
              The assistant is not configured: no OpenRouter API key is set. Ask an administrator to set OPENROUTER_API_KEY.
            </Banner>
          ) : null}
          {admin.loadNotice ? <Banner type={admin.loadNotice.type}>{admin.loadNotice.message}</Banner> : null}
          {refresh.overwriteWarning ? <OverwriteBanner onReload={() => openModal(refresh.confirmSlug)} /> : null}
          {threadId ? (
            <ChatPanel
              adminRoute={admin.adminRoute}
              apiRoute={admin.apiRoute}
              ApprovalComponent={ApprovalComponent}
              configured={configured}
              context={context}
              hrefFor={admin.hrefFor}
              isNew={!started}
              key={threadId}
              model={admin.model || admin.clientConfig?.defaultModel || ""}
              models={admin.clientConfig?.models ?? []}
              onActivity={() => setStarted(true)}
              onAppliedWrite={onAppliedWrite}
              onModelChange={admin.onModelChange}
              slugs={admin.slugs}
              threadId={threadId}
            />
          ) : null}
        </div>
      </Drawer>
    </>
  );
}
