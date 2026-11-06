"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Spinner, useLocale } from "@payloadcms/ui";

import type { AbResultsResponse } from "../../endpoints/measurement";
import type { VariantData } from "./VariantsField";
import { buildResultRows, conversionRate as rate } from "../resultRows";

interface VariantResultsProps {
  /** `{serverURL}{routes.api}{resultsPath}`. */
  url: string;
  collectionSlug: string;
  docId: string | number;
  /** The current variants: a bucket is a variant's slug (the default variant data). */
  variants: VariantData[];
}

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: AbResultsResponse };

const formatDate = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString();
};

/**
 * Results per bucket since the experiment started, under the variant rows. Mounted only when
 * the host configured measurement (the `resultsPath` client prop).
 */
export function VariantResults({ url, collectionSlug, docId, variants }: VariantResultsProps) {
  const { code: locale } = useLocale() ?? {};
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const query = new URLSearchParams({ collection: collectionSlug, id: String(docId) });
      if (locale) query.set("locale", locale);
      const res = await fetch(`${url}?${query}`, { credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState({ status: "error", message: body.error ?? `Request failed (${res.status})` });
        return;
      }
      setState({ status: "ready", data: body as AbResultsResponse });
    } catch {
      setState({ status: "error", message: "Couldn't load the results" });
    }
  }, [url, collectionSlug, docId, locale]);

  useEffect(() => {
    void load();
  }, [load]);

  let content: React.ReactNode;
  if (state.status === "loading") {
    content = (
      <div className="ab-results__message">
        <Spinner size="sm" loadingText={null} />
      </div>
    );
  } else if (state.status === "error") {
    content = <p className="ab-results__message">Results unavailable: {state.message}</p>;
  } else if (!state.data.experiment || !state.data.results) {
    content = (
      <p className="ab-results__message">Results start once a variant is published.</p>
    );
  } else if (!state.data.results.configured) {
    content = (
      <p className="ab-results__message" data-testid="ab-results-not-configured">
        Measurement isn't configured.
        {state.data.results.reason ? ` ${state.data.results.reason}` : ""}
      </p>
    );
  } else {
    const { results, experiment } = state.data;
    const rows = buildResultRows(results.buckets, variants);
    const total = rows.reduce(
      (sum, r) => ({
        impressions: sum.impressions + r.impressions,
        conversions: sum.conversions + r.conversions,
      }),
      { impressions: 0, conversions: 0 }
    );
    content = (
      <>
        <table className="ab-results__table" data-testid="ab-results-table">
          <thead>
            <tr>
              <th scope="col">Bucket</th>
              <th scope="col">Impressions</th>
              <th scope="col">Conversions</th>
              <th scope="col">Rate</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.bucket} className={row.deleted ? "ab-results__row--deleted" : undefined}>
                <th scope="row" title={row.label}>
                  {row.label}
                </th>
                <td>{row.impressions}</td>
                <td>{row.conversions}</td>
                <td>{rate(row.impressions, row.conversions)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              <td>{total.impressions}</td>
              <td>{total.conversions}</td>
              <td>{rate(total.impressions, total.conversions)}</td>
            </tr>
          </tfoot>
        </table>
        <p className="ab-results__note">
          Since {formatDate(experiment.startedAt)}. Each visitor counts once per bucket.
          {results.retentionDays
            ? ` Events older than ${results.retentionDays} days are no longer counted.`
            : ""}
        </p>
      </>
    );
  }

  return (
    <div className="ab-results" data-testid="ab-results">
      <div className="ab-results__header">
        <span className="ab-results__title">Results</span>
        <Button
          onClick={() => void load()}
          buttonStyle="ghost"
          size="medium"
          margin={false}
          disabled={state.status === "loading"}
        >
          Refresh
        </Button>
      </div>
      {content}
    </div>
  );
}
