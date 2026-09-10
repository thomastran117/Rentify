/**
 * The browser's own copy of the recently viewed list.
 *
 * This is the only store a signed-out visitor has, and for a signed-in one it
 * is a mirror that lets the rows paint on the first frame with no request. It
 * is never cleared on sign-in: signing out must not vaporise the list, and a
 * failed sync would otherwise be data loss.
 *
 * Modelled on `@/lib/theme/use-theme` -- a module-level listener set plus a
 * cached snapshot, read through `useSyncExternalStore`.
 */

const STORAGE_KEY = "rentify.recently-viewed.v1";
const TRACKING_KEY = "rentify.recently-viewed.enabled";

/** Matches the server's per-account cap, so the mirror cannot outgrow it. */
export const RECENTLY_VIEWED_LOCAL_CAP = 50;

const STORAGE_VERSION = 1;

export interface RecentlyViewedEntry {
  /** Posting identifier. */
  id: string;
  /** When it was viewed, epoch milliseconds. */
  at: number;
}

/**
 * The empty list, as a single frozen instance.
 *
 * Identity matters more than the value here: `useSyncExternalStore` compares
 * snapshots by reference and re-renders forever if a getter allocates. This is
 * both the server snapshot and the value every failed read falls back to.
 */
const EMPTY: readonly RecentlyViewedEntry[] = Object.freeze([]);

const listeners = new Set<() => void>();

let cache: readonly RecentlyViewedEntry[] | null = null;
let storageListenerAttached = false;

function canUseDom(): boolean {
  return typeof window !== "undefined";
}

function notify(): void {
  listeners.forEach((listener) => listener());
}

function isEntry(value: unknown): value is RecentlyViewedEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<RecentlyViewedEntry>;

  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.at === "number" &&
    Number.isFinite(candidate.at)
  );
}

/**
 * Reads and repairs what is in storage. Anything unparseable, of the wrong
 * version, or not shaped like an entry list is treated as absent rather than
 * thrown, so a bad write from an older build cannot break the page.
 */
function read(): readonly RecentlyViewedEntry[] {
  if (!canUseDom()) {
    return EMPTY;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return EMPTY;
    }

    const parsed: unknown = JSON.parse(raw);

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as { v?: unknown }).v !== STORAGE_VERSION ||
      !Array.isArray((parsed as { entries?: unknown }).entries)
    ) {
      return EMPTY;
    }

    const entries = (parsed as { entries: unknown[] }).entries.filter(isEntry);

    return entries.length > 0
      ? Object.freeze(entries.slice(0, RECENTLY_VIEWED_LOCAL_CAP))
      : EMPTY;
  } catch {
    // Private mode, disabled storage, or corrupt JSON.
    return EMPTY;
  }
}

function write(entries: readonly RecentlyViewedEntry[]): void {
  if (!canUseDom()) {
    return;
  }

  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ v: STORAGE_VERSION, entries }),
    );
  } catch {
    // Ignore storage failures (private mode, quota, disabled). The in-memory
    // cache still reflects the change for this page view.
  }
}

function commit(entries: readonly RecentlyViewedEntry[]): void {
  const next = entries.length > 0 ? Object.freeze(entries) : EMPTY;

  cache = next;
  write(next);
  notify();
}

/** Newest first, one entry per posting, capped. */
function normalize(
  entries: readonly RecentlyViewedEntry[],
): readonly RecentlyViewedEntry[] {
  const latestById = new Map<string, number>();

  for (const entry of entries) {
    const existing = latestById.get(entry.id);

    if (existing === undefined || entry.at > existing) {
      latestById.set(entry.id, entry.at);
    }
  }

  return Array.from(latestById, ([id, at]) => ({ id, at }))
    .sort((left, right) => right.at - left.at || left.id.localeCompare(right.id))
    .slice(0, RECENTLY_VIEWED_LOCAL_CAP);
}

export function getSnapshot(): readonly RecentlyViewedEntry[] {
  if (cache === null) {
    cache = read();
  }

  return cache;
}

/**
 * Always the same frozen empty list, so the server render and the first client
 * render agree and hydration stays stable. The real value arrives on the next
 * commit, after mount.
 */
export function getServerSnapshot(): readonly RecentlyViewedEntry[] {
  return EMPTY;
}

export function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);

  // Attached lazily, and only once, so a page that never reads the list pays
  // nothing. Another tab writing invalidates this tab's cache.
  if (canUseDom() && !storageListenerAttached) {
    storageListenerAttached = true;
    window.addEventListener("storage", (event) => {
      if (event.key !== null && event.key !== STORAGE_KEY) {
        return;
      }

      cache = null;
      notify();
    });
  }

  return () => {
    listeners.delete(onChange);
  };
}

/** Moves a posting to the front, or adds it. */
export function recordView(postingId: string, at: number = Date.now()): void {
  commit(normalize([{ id: postingId, at }, ...getSnapshot()]));
}

export function removeEntry(postingId: string): void {
  const current = getSnapshot();
  const next = current.filter((entry) => entry.id !== postingId);

  if (next.length !== current.length) {
    commit(next);
  }
}

export function clearAll(): void {
  commit([]);
}

/** Adopts the server's merged list after a sync. */
export function replaceAll(entries: readonly RecentlyViewedEntry[]): void {
  commit(normalize(entries));
}

/**
 * Whether this browser should record views.
 *
 * Signed-in callers have this on their profile and the server enforces it; the
 * local copy is what gives a signed-out visitor the same off switch, and what
 * stops a signed-in one building a local history the server would refuse.
 */
export function isTrackingEnabled(): boolean {
  if (!canUseDom()) {
    return true;
  }

  try {
    return window.localStorage.getItem(TRACKING_KEY) !== "false";
  } catch {
    return true;
  }
}

export function setTrackingEnabled(enabled: boolean): void {
  if (!canUseDom()) {
    return;
  }

  try {
    window.localStorage.setItem(TRACKING_KEY, enabled ? "true" : "false");
  } catch {
    // Ignore storage failures; the server remains the authority for accounts.
  }

  notify();
}

/** Test seam: drops the cached snapshot so the next read hits storage. */
export function resetCacheForTests(): void {
  cache = null;
}

/**
 * Server snapshot for the tracking preference. Permissive by default, matching
 * the column default, and a module-level function so the identity is stable.
 */
export function getTrackingServerSnapshot(): boolean {
  return true;
}
