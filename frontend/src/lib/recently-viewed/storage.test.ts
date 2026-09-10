import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  RECENTLY_VIEWED_LOCAL_CAP,
  clearAll,
  getServerSnapshot,
  getSnapshot,
  getTrackingServerSnapshot,
  isTrackingEnabled,
  recordView,
  removeEntry,
  replaceAll,
  resetCacheForTests,
  setTrackingEnabled,
  subscribe,
} from "./storage";

const STORAGE_KEY = "rentify.recently-viewed.v1";
const TRACKING_KEY = "rentify.recently-viewed.enabled";

function seed(entries: { id: string; at: number }[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, entries }));
  resetCacheForTests();
}

function stored(): { id: string; at: number }[] {
  const raw = window.localStorage.getItem(STORAGE_KEY);

  return raw ? JSON.parse(raw).entries : [];
}

describe("recently viewed storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetCacheForTests();
  });

  describe("snapshot identity", () => {
    // This is the one that matters: useSyncExternalStore compares snapshots by
    // reference, so a getter that allocates renders forever.
    it("returns the same reference across repeated reads", () => {
      seed([{ id: "posting-1", at: 1000 }]);

      expect(getSnapshot()).toBe(getSnapshot());
    });

    it("returns the same reference when storage is empty", () => {
      expect(getSnapshot()).toBe(getSnapshot());
    });

    it("returns a stable server snapshot that matches the empty client read", () => {
      expect(getServerSnapshot()).toBe(getServerSnapshot());
      expect(getServerSnapshot()).toEqual([]);
      expect(getSnapshot()).toBe(getServerSnapshot());
    });

    it("hands back a new reference only after a write", () => {
      const before = getSnapshot();

      recordView("posting-1");

      expect(getSnapshot()).not.toBe(before);
    });
  });

  describe("reading damaged storage", () => {
    it("treats unparseable JSON as no history", () => {
      window.localStorage.setItem(STORAGE_KEY, "{not json");
      resetCacheForTests();

      expect(getSnapshot()).toEqual([]);
    });

    it("treats a payload from a different version as no history", () => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ v: 99, entries: [{ id: "posting-1", at: 1 }] }),
      );
      resetCacheForTests();

      expect(getSnapshot()).toEqual([]);
    });

    it("drops entries that are not shaped like entries", () => {
      seed([
        { id: "posting-1", at: 1000 },
        { id: "", at: 2000 },
        { at: 3000 } as never,
        { id: "posting-2", at: Number.NaN },
      ]);

      expect(getSnapshot()).toEqual([{ id: "posting-1", at: 1000 }]);
    });

    it("survives a storage accessor that throws", () => {
      const getItem = vi
        .spyOn(window.localStorage, "getItem")
        .mockImplementation(() => {
          throw new Error("storage disabled");
        });

      expect(getSnapshot()).toEqual([]);

      getItem.mockRestore();
    });

    it("keeps working when a write is rejected", () => {
      const setItem = vi
        .spyOn(window.localStorage, "setItem")
        .mockImplementation(() => {
          throw new Error("quota exceeded");
        });

      expect(() => recordView("posting-1")).not.toThrow();
      // The in-memory snapshot still reflects the change for this page view.
      expect(getSnapshot()).toEqual([
        { id: "posting-1", at: expect.any(Number) },
      ]);

      setItem.mockRestore();
    });
  });

  describe("recordView", () => {
    it("puts the newest view at the front", () => {
      recordView("posting-1", 1000);
      recordView("posting-2", 2000);

      expect(getSnapshot().map((entry) => entry.id)).toEqual([
        "posting-2",
        "posting-1",
      ]);
    });

    it("promotes a re-view rather than duplicating it", () => {
      recordView("posting-1", 1000);
      recordView("posting-2", 2000);
      recordView("posting-1", 3000);

      expect(getSnapshot()).toEqual([
        { id: "posting-1", at: 3000 },
        { id: "posting-2", at: 2000 },
      ]);
    });

    it("evicts the oldest entry once the cap is reached", () => {
      for (let index = 0; index < RECENTLY_VIEWED_LOCAL_CAP + 3; index += 1) {
        recordView(`posting-${index}`, 1000 + index);
      }

      const snapshot = getSnapshot();

      expect(snapshot).toHaveLength(RECENTLY_VIEWED_LOCAL_CAP);
      expect(snapshot.map((entry) => entry.id)).not.toContain("posting-0");
      expect(snapshot[0].id).toBe(`posting-${RECENTLY_VIEWED_LOCAL_CAP + 2}`);
    });

    it("persists through storage", () => {
      recordView("posting-1", 1000);

      expect(stored()).toEqual([{ id: "posting-1", at: 1000 }]);
    });
  });

  describe("removeEntry and clearAll", () => {
    it("removes one entry", () => {
      recordView("posting-1", 1000);
      recordView("posting-2", 2000);

      removeEntry("posting-1");

      expect(getSnapshot().map((entry) => entry.id)).toEqual(["posting-2"]);
    });

    it("leaves the snapshot reference alone when nothing matched", () => {
      recordView("posting-1", 1000);
      const before = getSnapshot();

      removeEntry("posting-absent");

      expect(getSnapshot()).toBe(before);
    });

    it("clears everything", () => {
      recordView("posting-1", 1000);

      clearAll();

      expect(getSnapshot()).toEqual([]);
      expect(stored()).toEqual([]);
    });
  });

  describe("replaceAll", () => {
    it("adopts the given list, normalized", () => {
      recordView("posting-old", 1000);

      replaceAll([
        { id: "posting-a", at: 1000 },
        { id: "posting-b", at: 3000 },
        { id: "posting-a", at: 5000 },
      ]);

      expect(getSnapshot()).toEqual([
        { id: "posting-a", at: 5000 },
        { id: "posting-b", at: 3000 },
      ]);
    });
  });

  describe("subscribers", () => {
    it("notifies on write and stops after unsubscribe", () => {
      const listener = vi.fn();
      const unsubscribe = subscribe(listener);

      recordView("posting-1", 1000);
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();
      recordView("posting-2", 2000);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("invalidates the cache when another tab writes", () => {
      const listener = vi.fn();
      subscribe(listener);

      expect(getSnapshot()).toEqual([]);

      // Another tab's write does not go through this module's mutators.
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ v: 1, entries: [{ id: "posting-9", at: 9000 }] }),
      );
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));

      expect(listener).toHaveBeenCalled();
      expect(getSnapshot()).toEqual([{ id: "posting-9", at: 9000 }]);
    });

    it("ignores storage events for unrelated keys", () => {
      const listener = vi.fn();
      subscribe(listener);

      window.dispatchEvent(
        new StorageEvent("storage", { key: "rentify-theme" }),
      );

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("tracking preference", () => {
    it("defaults to enabled", () => {
      expect(isTrackingEnabled()).toBe(true);
      expect(getTrackingServerSnapshot()).toBe(true);
    });

    it("round-trips an opt-out", () => {
      setTrackingEnabled(false);

      expect(window.localStorage.getItem(TRACKING_KEY)).toBe("false");
      expect(isTrackingEnabled()).toBe(false);

      setTrackingEnabled(true);

      expect(isTrackingEnabled()).toBe(true);
    });

    it("notifies subscribers so the store stays in step", () => {
      const listener = vi.fn();
      subscribe(listener);

      setTrackingEnabled(false);

      expect(listener).toHaveBeenCalled();
    });

    it("stays enabled when storage cannot be read", () => {
      const getItem = vi
        .spyOn(window.localStorage, "getItem")
        .mockImplementation(() => {
          throw new Error("storage disabled");
        });

      expect(isTrackingEnabled()).toBe(true);

      getItem.mockRestore();
    });

    it("does not throw when the preference cannot be written", () => {
      const setItem = vi
        .spyOn(window.localStorage, "setItem")
        .mockImplementation(() => {
          throw new Error("quota exceeded");
        });

      expect(() => setTrackingEnabled(false)).not.toThrow();

      setItem.mockRestore();
    });
  });
});
