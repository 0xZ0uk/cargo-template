"use client";

import { Button, Link, Pill, XIcon } from "@payloadcms/ui";
import React from "react";
import type { DocumentReference } from "../references";
import type { DocumentRef } from "./tools";

export interface ReferenceChipsProps {
  references: ReadonlyArray<DocumentReference>;
  /** Edit-view links for the chips (only for slugs in the admin config). */
  hrefFor?: (ref: DocumentRef) => string | undefined;
  /** Shown before the chips, e.g. "About". */
  label?: string;
  /** Composer chips: a remove button each. */
  onRemove?: (ref: DocumentReference) => void;
  className?: string;
}

/** Documents a message is about (#69), as small chips: the collection (or "global") and the title. */
export function ReferenceChips({ references, hrefFor, label, onRemove, className }: ReferenceChipsProps) {
  if (!references.length) return null;
  return (
    <ul aria-label={label ?? "Mentioned documents"} className={["assistant-chips", className].filter(Boolean).join(" ")}>
      {label ? <li className="assistant-chips__label assistant-text assistant-text--tertiary assistant-text--small">{label}</li> : null}
      {references.map((ref) => {
        const key = ref.kind === "global" ? `global:${ref.slug}` : `${ref.slug}:${ref.id}`;
        const href = hrefFor?.({ kind: ref.kind, slug: ref.slug, ...(ref.id ? { id: ref.id } : {}), label: ref.title });
        const title = (
          <>
            <span className="assistant-chip__kind">{ref.kind === "global" ? "global" : ref.slug}</span>
            <span className="assistant-chip__title">{ref.title}</span>
          </>
        );
        return (
          <li className="assistant-chip" key={key}>
            <Pill pillStyle="light-gray" size="small">
              {href && !onRemove ? (
                <Link className="assistant-chip__link" href={href} prefetch={false}>
                  {title}
                </Link>
              ) : (
                <span className="assistant-chip__link">{title}</span>
              )}
            </Pill>
            {onRemove ? (
              <Button
                aria-label={`Remove ${ref.title}`}
                buttonStyle="ghost"
                className="assistant-chip__remove"
                icon={<XIcon />}
                margin={false}
                onClick={() => onRemove(ref)}
                round
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
