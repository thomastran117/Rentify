"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { authApi } from "@/lib/auth/api";

interface UsernameSuggestionsProps {
  disabled?: boolean;
  onSelect: (username: string) => void;
}

export function UsernameSuggestions({
  disabled = false,
  onSelect,
}: UsernameSuggestionsProps) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const abortController = new AbortController();

    authApi
      .getUsernameSuggestions(3, { signal: abortController.signal })
      .then((result) => {
        if (!abortController.signal.aborted) {
          setSuggestions(result.suggestions);
        }
      })
      .catch((requestError: unknown) => {
        if (
          abortController.signal.aborted ||
          (requestError instanceof Error && requestError.name === "AbortError")
        ) {
          return;
        }

        setError(true);
      })
      .finally(() => {
        if (!abortController.signal.aborted) {
          setLoading(false);
        }
      });

    return () => abortController.abort();
  }, [refreshVersion]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/30">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
          Need inspiration?
        </p>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            setError(false);
            setRefreshVersion((current) => current + 1);
          }}
          disabled={disabled || loading}
          aria-label="Refresh username suggestions"
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60 dark:text-emerald-300 dark:hover:bg-emerald-950/50"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          Refresh
        </button>
      </div>

      <div className="mt-2 flex min-h-8 flex-wrap gap-2" aria-live="polite">
        {loading && suggestions.length === 0 ? (
          <span className="text-sm text-slate-500 dark:text-slate-400">
            Finding available usernames...
          </span>
        ) : null}

        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => onSelect(suggestion)}
            disabled={disabled}
            aria-label={`Use username ${suggestion}`}
            className="rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-sm font-medium text-emerald-800 transition hover:border-emerald-400 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-900 dark:bg-slate-900 dark:text-emerald-200 dark:hover:border-emerald-700 dark:hover:bg-emerald-950/40"
          >
            {suggestion}
          </button>
        ))}

        {error ? (
          <span className="text-sm text-slate-500 dark:text-slate-400">
            Suggestions are unavailable right now. You can still choose your own
            username.
          </span>
        ) : null}
      </div>
    </div>
  );
}
