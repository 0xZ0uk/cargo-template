"use client";

import { Button, ConfirmationModal, EditIcon, PlusIcon, TrashIcon, useModal } from "@payloadcms/ui";
import React, { useState } from "react";
import type { ConversationSummary } from "./api";
import { formatUsd } from "../usage";

export const DELETE_MODAL_SLUG = "assistant-delete-conversation";

export interface ConversationListProps {
  conversations: ConversationSummary[];
  activeThreadId: string;
  loading: boolean;
  onNew: () => void;
  onSelect: (threadId: string) => void;
  onRename: (threadId: string, title: string) => Promise<void>;
  onDelete: (threadId: string) => Promise<void>;
}

const MAX_TITLE = 200;

/** The caller's conversations: new, switch, rename inline, delete after a confirmation. */
export function ConversationList({
  conversations,
  activeThreadId,
  loading,
  onNew,
  onSelect,
  onRename,
  onDelete,
}: ConversationListProps) {
  const { openModal, closeModal } = useModal();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [pendingDelete, setPendingDelete] = useState<ConversationSummary | null>(null);

  const startRename = (conversation: ConversationSummary) => {
    setEditing(conversation.threadId);
    setDraft(conversation.title);
  };
  const commitRename = async () => {
    const threadId = editing;
    const title = draft.trim().slice(0, MAX_TITLE);
    setEditing(null);
    const current = conversations.find((c) => c.threadId === threadId);
    if (!threadId || !title || title === current?.title) return;
    await onRename(threadId, title);
  };

  return (
    <nav aria-label="Conversations" className="assistant-sidebar">
      <Button
        buttonStyle="secondary"
        className="assistant-sidebar__new"
        icon={<PlusIcon />}
        iconPosition="left"
        margin={false}
        onClick={onNew}
      >
        New conversation
      </Button>
      {conversations.length === 0 ? (
        <p className="assistant-text assistant-text--secondary assistant-text--small assistant-sidebar__empty">
          {loading ? "Loading…" : "No conversations yet."}
        </p>
      ) : (
        <ul className="assistant-sidebar__list">
          {conversations.map((conversation) => {
            const active = conversation.threadId === activeThreadId;
            const title = conversation.title || "Untitled";
            return (
              <li
                className={`assistant-sidebar__item${active ? " assistant-sidebar__item--active" : ""}`}
                key={conversation.threadId}
              >
                {editing === conversation.threadId ? (
                  <input
                    aria-label="Conversation title"
                    autoFocus
                    className="assistant-input"
                    maxLength={MAX_TITLE}
                    onBlur={() => void commitRename()}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void commitRename();
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        setEditing(null);
                      }
                    }}
                    value={draft}
                  />
                ) : (
                  <>
                    <button
                      aria-current={active ? "page" : undefined}
                      className="assistant-sidebar__select"
                      onClick={() => onSelect(conversation.threadId)}
                      title={title}
                      type="button"
                    >
                      <span className="assistant-sidebar__title">{title}</span>{" "}
                      {typeof conversation.costUsd === "number" ? (
                        <span className="assistant-text assistant-text--secondary assistant-text--small assistant-sidebar__cost">
                          {formatUsd(conversation.costUsd)}
                        </span>
                      ) : null}
                    </button>
                    <span className="assistant-sidebar__actions">
                      <Button
                        aria-label={`Rename “${title}”`}
                        buttonStyle="ghost"
                        icon={<EditIcon />}
                        margin={false}
                        onClick={() => startRename(conversation)}
                        tooltip="Rename"
                      />
                      <Button
                        aria-label={`Delete “${title}”`}
                        buttonStyle="ghost"
                        icon={<TrashIcon />}
                        margin={false}
                        onClick={() => {
                          setPendingDelete(conversation);
                          openModal(DELETE_MODAL_SLUG);
                        }}
                        tooltip="Delete"
                      />
                    </span>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <ConfirmationModal
        body={
          <p>
            “{pendingDelete?.title || "Untitled"}” and its history will be deleted. A reply still running is stopped.
            This can’t be undone.
          </p>
        }
        confirmLabel="Delete"
        heading="Delete this conversation?"
        modalSlug={DELETE_MODAL_SLUG}
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          const target = pendingDelete;
          setPendingDelete(null);
          closeModal(DELETE_MODAL_SLUG);
          if (target) await onDelete(target.threadId);
        }}
      />
    </nav>
  );
}
