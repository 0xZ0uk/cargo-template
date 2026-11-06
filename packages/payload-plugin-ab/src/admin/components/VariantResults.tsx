"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Spinner, useLocale } from "@payloadcms/ui";

import type { AbPastRun, AbResultsResponse } from "../../endpoints/measurement";
import type { AbResults } from "../../types/config";
import type { VariantData } from "./VariantsField";
import { buildResultRows, conversionRate as rate, type ResultRow, totalOf } from "../resultRows";

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

function NotConfigured({ results }: { results: Extract<AbResults, { configured: false }> }) {
  return (
    <p className="ab-results__message" data-testid="ab-results-not-configured">
      Measurement isn't configured.
      {results.reason ? ` ${results.reason}` : ""}
    </p>
  );
}

function ResultsTable({ rows }: { rows: ResultRow[] }) {
  const total = totalOf(rows);
  return (
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
  );
}

/** Runs that ended in the last 90 days, collapsed under the current results. */
function PastRuns({ runs, variants }: { runs: AbPastRun[]; variants: VariantData[] }) {
  return (
    <details className="ab-results__past" data-testid="ab-past-runs">
      <summary>Past experiments ({runs.length})</summary>
      {runs.map((run) => (
        <section key={`${run.key}@${run.startedAt}`} className="ab-results__run" data-testid="ab-past-run">
          <p className="ab-results__run-dates">
            {formatDate(run.startedAt)} – {formatDate(run.endedAt)}
          </p>
          {!run.results ? (
            <p className="ab-results__message">Results unavailable: {run.error ?? "unknown error"}</p>
          ) : !run.results.configured ? (
            <NotConfigured results={run.results} />
          ) : (
            <ResultsTable
              rows={buildResultRows(run.results.buckets, variants, { onlyWithData: true })}
            />
          )}
        </section>
      ))}
      <p className="ab-results__note">Past experiments are kept for 90 days after they end.</p>
    </details>
  );
}

/**
 * Results per bucket for the current run, under the variant rows, and the runs that ended in
 * the last 90 days. Mounted only when the host configured measurement (the `resultsPath`
 * client prop). With no variants left it shows only past runs, and nothing without any.
 */
export function VariantResults({ url, collectionSlug, docId, variants }: VariantResultsProps) {
  const { code: locale } = useLocale() ?? {};
  const [state, setState] = useState<State>({ status: "loading" });
  // Reload when variants come or go: deleting the last one ends the run.
  const variantIds = variants.map((v) => v.id).join(",");

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
  }, [url, collectionSlug, docId, locale, variantIds]);

  useEffect(() => {
    void load();
  }, [load]);

  const pastRuns = state.status === "ready" ? (state.data.pastRuns ?? []) : [];
  if (!variants.length) {
    // Nothing runs on the page: only past experiments are worth the space.
    if (state.status === "loading") return null;
    if (state.status === "ready" && !state.data.experiment && !pastRuns.length) return null;
  }

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
      <p className="ab-results__message">
        {variants.length
          ? "Results start once a variant is published."
          : "No experiment is running on this page."}
      </p>
    );
  } else if (!state.data.results.configured) {
    content = <NotConfigured results={state.data.results} />;
  } else {
    const { results, experiment } = state.data;
    content = (
      <>
        <ResultsTable rows={buildResultRows(results.buckets, variants)} />
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
      {pastRuns.length > 0 && <PastRuns runs={pastRuns} variants={variants} />}
    </div>
  );
}
