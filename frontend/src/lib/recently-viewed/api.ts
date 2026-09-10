import {
  authenticatedJson,
  buildPathWithQuery,
  optionalAuthJson,
} from "@/lib/api/client";
import type { PublicPostingSummary } from "@/lib/postings/search";

/** Matches the server's per-account cap and its sync batch limit. */
export const RECENTLY_VIEWED_SYNC_MAX = 50;

export interface RecentlyViewedPostingSummary extends PublicPostingSummary {
  viewedAt: string;
}

export interface ListRecentlyViewedResult {
  postings: RecentlyViewedPostingSummary[];
  /**
   * False when the account has turned view tracking off. Clients should stop
   * recording, including into their own local mirror.
   */
  trackingEnabled: boolean;
}

export interface SyncRecentlyViewedEntry {
  postingId: string;
  viewedAt: string;
}

export interface ListRecentlyViewedInput {
  limit?: number;
}

export const recentlyViewedApi = {
  /**
   * Fire-and-forget. Deliberately optional-auth and deliberately swallows its
   * own rejection: a returning visitor is still resolving their session when
   * the posting page mounts, so the caller cannot usefully branch on auth
   * first, and a view that fails to record is not worth interrupting anyone
   * over. The next sync repairs anything missed.
   */
  async recordView(postingId: string): Promise<void> {
    try {
      await optionalAuthJson<{ accepted: true }>(
        "POST",
        `/postings/${encodeURIComponent(postingId)}/activity/view`,
      );
    } catch {
      // Intentionally ignored.
    }
  },
  list(
    input: ListRecentlyViewedInput = {},
    signal?: AbortSignal,
  ): Promise<ListRecentlyViewedResult> {
    return authenticatedJson<ListRecentlyViewedResult>(
      "GET",
      buildPathWithQuery("/postings/recently-viewed", {
        limit: input.limit ?? 24,
      }),
      undefined,
      undefined,
      signal,
    );
  },
  sync(
    entries: SyncRecentlyViewedEntry[],
    input: ListRecentlyViewedInput = {},
    signal?: AbortSignal,
  ): Promise<ListRecentlyViewedResult> {
    return authenticatedJson<
      ListRecentlyViewedResult,
      { entries: SyncRecentlyViewedEntry[] }
    >(
      "POST",
      buildPathWithQuery("/postings/recently-viewed/sync", {
        limit: input.limit ?? 24,
      }),
      { entries: entries.slice(0, RECENTLY_VIEWED_SYNC_MAX) },
      undefined,
      signal,
    );
  },
  clear(): Promise<void> {
    return authenticatedJson<void>("DELETE", "/postings/recently-viewed");
  },
  remove(postingId: string): Promise<void> {
    return authenticatedJson<void>(
      "DELETE",
      `/postings/recently-viewed/${encodeURIComponent(postingId)}`,
    );
  },
};
