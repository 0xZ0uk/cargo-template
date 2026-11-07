"use client";

import { useConfig } from "@payloadcms/ui";
import { formatAdminURL } from "payload/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AssistantClientConfig } from "./api";
import { fetchAssistantConfig } from "./api";
import type { AssistantNotice } from "./errors";
import { noticeForClientError } from "./errors";
import type { DocumentRef, EntitySlugs } from "./tools";

/**
 * What every chat surface needs from the admin (the `/admin/assistant` view and the edit view's
 * drawer, #69): routes, the slugs that have edit views, edit-view links, the assistant's config and
 * the chosen model (kept in `localStorage`, shared by both).
 */

const MODEL_STORAGE_KEY = "shipment-assistant:model";

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

export interface AssistantAdminContext {
  apiRoute: string;
  adminRoute: string;
  slugs: EntitySlugs;
  hrefFor: (ref: DocumentRef) => string;
  clientConfig: AssistantClientConfig | null;
  loadNotice: AssistantNotice | null;
  model: string;
  onModelChange: (model: string) => void;
}

export function useAssistantAdminContext(): AssistantAdminContext {
  const { config } = useConfig();
  const apiRoute = config.routes?.api ?? "/api";
  const adminRoute = config.routes?.admin ?? "/admin";
  const [clientConfig, setClientConfig] = useState<AssistantClientConfig | null>(null);
  const [loadNotice, setLoadNotice] = useState<AssistantNotice | null>(null);
  const [model, setModel] = useState<string>("");

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

  return { apiRoute, adminRoute, slugs, hrefFor, clientConfig, loadNotice, model, onModelChange };
}
