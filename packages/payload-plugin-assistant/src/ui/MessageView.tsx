"use client";

import { Collapsible, Link } from "@payloadcms/ui";
import { TextPart } from "@tanstack/ai-react/ui";
import React, { useMemo } from "react";
import { ToolCallRow } from "./ToolCallRow";
import type { DocumentRef, EntitySlugs, ToolCallLike, ToolResultLike } from "./tools";
import { documentRefs } from "./tools";

/** The parts of a `UIMessage` the chat renders; anything else is skipped. */
export interface MessageLike {
  id: string;
  role: string;
  parts: ReadonlyArray<{ type: string; [key: string]: unknown }>;
}

export interface MessageViewProps {
  message: MessageLike;
  /** Every tool result in the conversation, by tool call id (results may arrive in a later message). */
  results: ReadonlyMap<string, ToolResultLike>;
  slugs: EntitySlugs;
  /** The admin route (`/admin`): links under it navigate inside the admin. */
  adminRoute: string;
  hrefFor: (ref: DocumentRef) => string;
  /**
   * Renders a tool call instead of its row (the approval card of a write), or `undefined` for
   * the default row.
   */
  renderToolCall?: (call: ToolCallLike, result: ToolResultLike | undefined) => React.ReactNode | undefined;
}

/** Collects tool results by `toolCallId` across messages. */
export function collectToolResults(messages: ReadonlyArray<MessageLike>): Map<string, ToolResultLike> {
  const results = new Map<string, ToolResultLike>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "tool-result" && typeof part.toolCallId === "string") {
        results.set(part.toolCallId, part as unknown as ToolResultLike);
      }
    }
  }
  return results;
}

/**
 * The admin path of a link the model wrote, or `undefined` when it leads elsewhere: a path under
 * the admin route, or an absolute URL on this origin (the system prompt gives the model the
 * site's URL, so it often writes `https://site/admin/collections/pages/1`).
 */
export function adminPathOf(
  href: string,
  adminRoot: string,
  origin = typeof window !== "undefined" ? window.location.origin : undefined
): string | undefined {
  let path: string;
  if (href.startsWith("/") && !href.startsWith("//")) path = href;
  else {
    try {
      const url = new URL(href);
      if (!origin || url.origin !== origin) return undefined;
      path = `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return undefined;
    }
  }
  const root = adminRoot.replace(/\/+$/, "") || "/";
  if (root === "/") return path;
  return path === root || path.startsWith(`${root}/`) || path.startsWith(`${root}?`) ? path : undefined;
}

/**
 * Markdown links: an admin path navigates in place (Payload's `Link`), anything else opens in a
 * new tab without an opener. `@tanstack/markdown` has already escaped raw HTML and dropped
 * executable URLs (`javascript:` and the like), so `href` is never script.
 */
function markdownComponents(adminRoute: string) {
  const root = adminRoute.replace(/\/+$/, "") || "/";
  const MarkdownLink = ({ href, children, title }: { href?: string; children?: React.ReactNode; title?: string }) => {
    if (!href) return <span>{children}</span>;
    const path = adminPathOf(href, root);
    if (path) {
      return (
        <Link className="assistant-link" href={path} prefetch={false} title={title}>
          {children}
        </Link>
      );
    }
    return (
      <a className="assistant-link" href={href} rel="noopener noreferrer" target="_blank" title={title}>
        {children}
      </a>
    );
  };
  return { a: MarkdownLink };
}

/** One message: Markdown text, reasoning collapsed, tool calls as compact rows. */
export function MessageView({ message, results, slugs, adminRoute, hrefFor, renderToolCall }: MessageViewProps) {
  const components = useMemo(() => markdownComponents(adminRoute), [adminRoute]);
  const isUser = message.role === "user";

  const rendered = message.parts.map((part, index) => {
    const key = `${message.id}:${index}`;
    switch (part.type) {
      case "text": {
        const content = typeof part.content === "string" ? part.content : "";
        if (!content) return null;
        // The user's own words stay plain text: no Markdown surprises in what they typed.
        if (isUser) {
          return (
            <p className="assistant-message__plain" key={key}>
              {content}
            </p>
          );
        }
        return (
          <TextPart
            className="assistant-markdown"
            components={components}
            content={content}
            key={key}
            role="assistant"
          />
        );
      }
      case "thinking": {
        const content = typeof part.content === "string" ? part.content : "";
        if (!content) return null;
        return (
          <Collapsible
            className="assistant-reasoning"
            header={<span className="assistant-text assistant-text--secondary assistant-text--small">Reasoning</span>}
            initCollapsed
            key={key}
          >
            <p className="assistant-reasoning__text">{content}</p>
          </Collapsible>
        );
      }
      case "tool-call": {
        const call = part as unknown as ToolCallLike;
        const result = results.get(call.id);
        const custom = renderToolCall?.(call, result);
        if (custom !== undefined) return <React.Fragment key={key}>{custom}</React.Fragment>;
        return (
          <ToolCallRow
            call={call}
            documents={documentRefs(call, result, slugs)}
            hrefFor={hrefFor}
            key={key}
            result={result}
          />
        );
      }
      default:
        // tool-result (shown in its call's row), activity, structured output…: not rendered.
        return null;
    }
  });

  if (!rendered.some(Boolean)) return null;
  return (
    <article
      aria-label={isUser ? "You" : "Assistant"}
      className={`assistant-message assistant-message--${isUser ? "user" : "assistant"}`}
    >
      {rendered}
    </article>
  );
}
