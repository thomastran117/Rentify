"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useAuth } from "@/components/auth/auth-context";
import { useErrorToast } from "@/components/errors";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import { postingsApi } from "@/lib/postings/api";
import type { PublicPostingSummary } from "@/lib/postings/search";
import {
  recentlyViewedApi,
  type RecentlyViewedPostingSummary,
} from "@/lib/recently-viewed/api";
import {
  clearAll as clearLocal,
  getServerSnapshot,
  getSnapshot,
  getTrackingServerSnapshot,
  isTrackingEnabled as readTrackingEnabled,
  recordView as recordLocalView,
  removeEntry as removeLocalEntry,
  replaceAll as replaceLocal,
  setTrackingEnabled as writeTrackingEnabled,
  subscribe,
  type RecentlyViewedEntry,
} from "@/lib/recently-viewed/storage";

export type RecentlyViewedStatus = "loading" | "ready" | "error";

interface RecentlyViewedContextValue {
  status: RecentlyViewedStatus;
  /** Hydrated cards, most recently viewed first. */
  postings: RecentlyViewedPostingSummary[];
  /** Whether this browser is still recording views. */
  trackingEnabled: boolean;
  recordView: (postingId: string) => void;
  remove: (postingId: string) => Promise<void>;
  clear: () => Promise<void>;
  setTrackingEnabled: (enabled: boolean) => void;
  refresh: () => void;
}

const RecentlyViewedContext = createContext<RecentlyViewedContextValue | null>(
  null,
);

function toSummary(
  posting: PublicPostingSummary,
  viewedAt: number,
): RecentlyViewedPostingSummary {
  return { ...posting, viewedAt: new Date(viewedAt).toISOString() };
}

export function RecentlyViewedProvider({ children }: { children: ReactNode }) {
  const { status: authStatus, session } = useAuth();
  const { showError } = useErrorToast();

  const entries = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  // Read through the same store as the entries. The preference is external
  // state, so mirroring it into component state would only add a render pass
  // and would miss changes made in another tab.
  const trackingEnabled = useSyncExternalStore(
    subscribe,
    readTrackingEnabled,
    getTrackingServerSnapshot,
  );

  const [postings, setPostings] = useState<RecentlyViewedPostingSummary[]>([]);
  const [status, setStatus] = useState<RecentlyViewedStatus>("loading");
  const [refreshToken, setRefreshToken] = useState(0);

  // Sync runs once per signed-in session, not on every render. Keyed by user so
  // switching accounts in one tab re-syncs against the new identity.
  const syncedUserIdRef = useRef<string | null>(null);

  const userId = session?.user?.id ?? null;

  // Changes whenever the local mirror changes, which is what makes the
  // signed-out list re-hydrate. The provider lives in the root layout and so
  // stays mounted across client-side navigation: without this, a view
  // recorded on a posting page would not appear when the visitor navigated
  // to a page that renders the row.
  // The signed-in branch is driven by `refreshToken` instead, because it
  // writes the mirror itself and would otherwise re-enter the effect on its
  // own output.
  const localHydrationKey =
    authStatus === "authenticated"
      ? ""
      : entries.map((entry) => entry.id).join(",");

  useEffect(() => {
    // A returning visitor sits in "loading" while /auth/refresh settles. Acting
    // on that would sync one identity's history into another, so nothing runs
    // until the status resolves. The local list is already on screen.
    if (authStatus === "loading") {
      return;
    }

    let active = true;
    const controller = new AbortController();

    async function hydrateAnonymous() {
      const localEntries = getSnapshot();

      if (localEntries.length === 0) {
        setPostings([]);
        setStatus("ready");
        return;
      }

      try {
        const batch = await postingsApi.batchPublic(
          localEntries.map((entry) => entry.id),
        );

        if (!active) {
          return;
        }

        const viewedAtById = new Map(
          localEntries.map((entry) => [entry.id, entry.at]),
        );

        // Anything the batch could not return is gone for good, so it is
        // dropped from the mirror rather than retried on every page.
        if (batch.missingIds.length > 0) {
          replaceLocal(
            localEntries.filter(
              (entry) => !batch.missingIds.includes(entry.id),
            ),
          );
        }

        setPostings(
          batch.postings.map((posting) =>
            toSummary(posting, viewedAtById.get(posting.id) ?? 0),
          ),
        );
        setStatus("ready");
      } catch {
        if (active) {
          setStatus("error");
        }
      }
    }

    async function loadAuthenticated(currentUserId: string) {
      const localEntries = getSnapshot();
      const shouldSync =
        syncedUserIdRef.current !== currentUserId && localEntries.length > 0;

      try {
        const result = shouldSync
          ? await recentlyViewedApi.sync(
              localEntries.map((entry) => ({
                postingId: entry.id,
                viewedAt: new Date(entry.at).toISOString(),
              })),
              {},
              controller.signal,
            )
          : await recentlyViewedApi.list({}, controller.signal);

        if (!active) {
          return;
        }

        syncedUserIdRef.current = currentUserId;

        // The server already merged both sides with the later timestamp
        // winning, so its answer is adopted wholesale rather than unioned
        // again on the client.
        replaceLocal(
          result.postings.map((posting) => ({
            id: posting.id,
            at: Date.parse(posting.viewedAt),
          })),
        );
        writeTrackingEnabled(result.trackingEnabled);
        setPostings(result.postings);
        setStatus("ready");
      } catch {
        if (active) {
          setStatus("error");
        }
      }
    }

    setStatus("loading");

    if (authStatus === "authenticated" && userId) {
      void loadAuthenticated(userId);
    } else {
      syncedUserIdRef.current = null;
      void hydrateAnonymous();
    }

    return () => {
      active = false;
      controller.abort();
    };
  }, [authStatus, userId, refreshToken, localHydrationKey]);

  const recordView = useCallback(
    (postingId: string) => {
      if (!readTrackingEnabled()) {
        return;
      }

      recordLocalView(postingId);

      void (async () => {
        await recentlyViewedApi.recordView(postingId);

        // A signed-out list re-hydrates off the mirror on its own. A
        // signed-in one is served by the account, so it has to be re-read
        // once the write has landed.
        if (authStatus === "authenticated") {
          setRefreshToken((current) => current + 1);
        }
      })();
    },
    [authStatus],
  );

  const remove = useCallback(
    async (postingId: string) => {
      removeLocalEntry(postingId);
      setPostings((current) =>
        current.filter((posting) => posting.id !== postingId),
      );

      if (authStatus !== "authenticated") {
        return;
      }

      try {
        await recentlyViewedApi.remove(postingId);
      } catch (error) {
        // Reported as a toast rather than through the page-level error state,
        // which would replace the very list the visitor is editing.
        showError({
          title: "Couldn't remove that posting",
          message: getApiErrorMessage(error, {
            action: "remove that posting from your history",
            fallback:
              "We couldn't update your recently viewed postings. Please try again.",
          }),
          tone: "error",
        });
        setRefreshToken((current) => current + 1);
      }
    },
    [authStatus, showError],
  );

  const clear = useCallback(async () => {
    clearLocal();
    setPostings([]);

    if (authStatus !== "authenticated") {
      return;
    }

    try {
      await recentlyViewedApi.clear();
    } catch (error) {
      showError({
        title: "Couldn't clear your history",
        message: getApiErrorMessage(error, {
          action: "clear your recently viewed postings",
          fallback:
            "We couldn't clear your recently viewed postings. Please try again.",
        }),
        tone: "error",
      });
      setRefreshToken((current) => current + 1);
    }
  }, [authStatus, showError]);

  const setTrackingEnabled = useCallback((enabled: boolean) => {
    writeTrackingEnabled(enabled);
  }, []);

  const refresh = useCallback(() => {
    setRefreshToken((current) => current + 1);
  }, []);

  const value = useMemo<RecentlyViewedContextValue>(
    () => ({
      status,
      postings,
      trackingEnabled,
      recordView,
      remove,
      clear,
      setTrackingEnabled,
      refresh,
    }),
    [
      clear,
      postings,
      recordView,
      refresh,
      remove,
      setTrackingEnabled,
      status,
      trackingEnabled,
    ],
  );

  return (
    <RecentlyViewedContext.Provider value={value}>
      {children}
    </RecentlyViewedContext.Provider>
  );
}

export function useRecentlyViewed(): RecentlyViewedContextValue {
  const context = useContext(RecentlyViewedContext);

  if (!context) {
    throw new Error(
      "useRecentlyViewed must be used within a RecentlyViewedProvider.",
    );
  }

  return context;
}

export type { RecentlyViewedEntry };
