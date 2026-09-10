import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  RecentlyViewedProvider,
  useRecentlyViewed,
} from "./recently-viewed-context";
import {
  recordView as recordLocalView,
  resetCacheForTests,
  setTrackingEnabled,
} from "@/lib/recently-viewed/storage";

const {
  useAuthMock,
  showErrorMock,
  batchPublicMock,
  listMock,
  syncMock,
  clearMock,
  removeMock,
  recordViewMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  showErrorMock: vi.fn(),
  batchPublicMock: vi.fn(),
  listMock: vi.fn(),
  syncMock: vi.fn(),
  clearMock: vi.fn(),
  removeMock: vi.fn(),
  recordViewMock: vi.fn(),
}));

vi.mock("@/components/auth/auth-context", () => ({
  useAuth: useAuthMock,
}));

vi.mock("@/components/errors", () => ({
  useErrorToast: () => ({ showError: showErrorMock }),
}));

vi.mock("@/lib/postings/api", () => ({
  postingsApi: { batchPublic: batchPublicMock },
}));

vi.mock("@/lib/recently-viewed/api", () => ({
  recentlyViewedApi: {
    list: listMock,
    sync: syncMock,
    clear: clearMock,
    remove: removeMock,
    recordView: recordViewMock,
  },
}));

function makePosting(id: string, viewedAt = "2026-09-08T12:00:00.000Z") {
  return {
    id,
    name: `Posting ${id}`,
    description: "A place.",
    variant: { family: "place", subtype: "workspace" },
    pricing: { currency: "CAD", daily: { amount: 120 } },
    location: { city: "Toronto", region: "Ontario", country: "Canada" },
    tags: [],
    availabilityStatus: "available" as const,
    viewedAt,
  };
}

function Consumer() {
  const { status, postings, trackingEnabled, recordView, remove, clear } =
    useRecentlyViewed();

  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="tracking">{trackingEnabled ? "on" : "off"}</span>
      <span data-testid="ids">
        {postings.map((posting) => posting.id).join(",")}
      </span>
      <button type="button" onClick={() => recordView("posting-new")}>
        record
      </button>
      <button type="button" onClick={() => void remove("posting-a")}>
        remove
      </button>
      <button type="button" onClick={() => void clear()}>
        clear
      </button>
    </div>
  );
}

function renderProvider() {
  return render(
    <RecentlyViewedProvider>
      <Consumer />
    </RecentlyViewedProvider>,
  );
}

function anonymous() {
  useAuthMock.mockReturnValue({ status: "anonymous", session: null });
}

function authenticated(userId = "user-1") {
  useAuthMock.mockReturnValue({
    status: "authenticated",
    session: { user: { id: userId } },
  });
}

describe("RecentlyViewedProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetCacheForTests();
    batchPublicMock.mockResolvedValue({ postings: [], missingIds: [] });
    listMock.mockResolvedValue({ postings: [], trackingEnabled: true });
    syncMock.mockResolvedValue({ postings: [], trackingEnabled: true });
    clearMock.mockResolvedValue(undefined);
    removeMock.mockResolvedValue(undefined);
  });

  describe("anonymous visitors", () => {
    it("hydrates the local list through the public batch endpoint", async () => {
      recordLocalView("posting-a", 2000);
      recordLocalView("posting-b", 1000);
      anonymous();
      batchPublicMock.mockResolvedValue({
        postings: [makePosting("posting-a"), makePosting("posting-b")],
        missingIds: [],
      });

      renderProvider();

      await waitFor(() =>
        expect(screen.getByTestId("status")).toHaveTextContent("ready"),
      );
      expect(batchPublicMock).toHaveBeenCalledWith(["posting-a", "posting-b"]);
      expect(screen.getByTestId("ids")).toHaveTextContent(
        "posting-a,posting-b",
      );
      // Nothing is written to the account for a signed-out visitor.
      expect(listMock).not.toHaveBeenCalled();
      expect(syncMock).not.toHaveBeenCalled();
    });

    it("skips the request entirely with no local history", async () => {
      anonymous();

      renderProvider();

      await waitFor(() =>
        expect(screen.getByTestId("status")).toHaveTextContent("ready"),
      );
      expect(batchPublicMock).not.toHaveBeenCalled();
    });

    it("prunes postings the batch could not return", async () => {
      recordLocalView("posting-a", 2000);
      recordLocalView("posting-gone", 1000);
      anonymous();
      batchPublicMock.mockResolvedValue({
        postings: [makePosting("posting-a")],
        missingIds: ["posting-gone"],
      });

      renderProvider();

      await waitFor(() =>
        expect(screen.getByTestId("ids")).toHaveTextContent("posting-a"),
      );
      expect(
        JSON.parse(
          window.localStorage.getItem("rentify.recently-viewed.v1") ?? "{}",
        ).entries,
      ).toEqual([{ id: "posting-a", at: 2000 }]);
    });

    it("reports an error when hydration fails", async () => {
      recordLocalView("posting-a", 2000);
      anonymous();
      batchPublicMock.mockRejectedValue(new Error("offline"));

      renderProvider();

      await waitFor(() =>
        expect(screen.getByTestId("status")).toHaveTextContent("error"),
      );
    });
  });

  describe("while the session is still resolving", () => {
    // A returning visitor sits in "loading" until /auth/refresh settles. Acting
    // then would sync one identity's history into another.
    it("issues no request at all", async () => {
      recordLocalView("posting-a", 2000);
      useAuthMock.mockReturnValue({ status: "loading", session: null });

      renderProvider();

      await waitFor(() =>
        expect(screen.getByTestId("status")).toHaveTextContent("loading"),
      );
      expect(batchPublicMock).not.toHaveBeenCalled();
      expect(listMock).not.toHaveBeenCalled();
      expect(syncMock).not.toHaveBeenCalled();
    });
  });

  describe("signed-in visitors", () => {
    it("syncs the local mirror up and adopts the merged answer", async () => {
      recordLocalView("posting-a", 2000);
      authenticated();
      syncMock.mockResolvedValue({
        postings: [
          makePosting("posting-server", "2026-09-07T00:00:00.000Z"),
          makePosting("posting-a", "2026-09-06T00:00:00.000Z"),
        ],
        trackingEnabled: true,
      });

      renderProvider();

      await waitFor(() =>
        expect(screen.getByTestId("status")).toHaveTextContent("ready"),
      );
      expect(syncMock).toHaveBeenCalledWith(
        [{ postingId: "posting-a", viewedAt: new Date(2000).toISOString() }],
        {},
        expect.anything(),
      );
      // The server merged both sides; its answer is adopted wholesale rather
      // than unioned again here.
      expect(screen.getByTestId("ids")).toHaveTextContent(
        "posting-server,posting-a",
      );
      expect(listMock).not.toHaveBeenCalled();
    });

    it("lists rather than syncing when there is nothing local to send", async () => {
      authenticated();
      listMock.mockResolvedValue({
        postings: [makePosting("posting-server")],
        trackingEnabled: true,
      });

      renderProvider();

      await waitFor(() =>
        expect(screen.getByTestId("ids")).toHaveTextContent("posting-server"),
      );
      expect(syncMock).not.toHaveBeenCalled();
      expect(listMock).toHaveBeenCalled();
    });

    it("syncs only once per session", async () => {
      recordLocalView("posting-a", 2000);
      authenticated();

      const { rerender } = renderProvider();

      await waitFor(() => expect(syncMock).toHaveBeenCalledTimes(1));

      rerender(
        <RecentlyViewedProvider>
          <Consumer />
        </RecentlyViewedProvider>,
      );

      await waitFor(() =>
        expect(screen.getByTestId("status")).toHaveTextContent("ready"),
      );
      expect(syncMock).toHaveBeenCalledTimes(1);
    });

    it("adopts an opt-out made on another device", async () => {
      authenticated();
      listMock.mockResolvedValue({ postings: [], trackingEnabled: false });

      renderProvider();

      await waitFor(() =>
        expect(screen.getByTestId("tracking")).toHaveTextContent("off"),
      );
    });

    it("reports an error when the load fails", async () => {
      authenticated();
      listMock.mockRejectedValue(new Error("offline"));

      renderProvider();

      await waitFor(() =>
        expect(screen.getByTestId("status")).toHaveTextContent("error"),
      );
    });
  });

  describe("recording", () => {
    it("writes locally and fires the request", async () => {
      anonymous();
      renderProvider();
      await waitFor(() =>
        expect(screen.getByTestId("status")).toHaveTextContent("ready"),
      );

      await userEvent.click(screen.getByRole("button", { name: "record" }));

      expect(recordViewMock).toHaveBeenCalledWith("posting-new");
      expect(
        JSON.parse(
          window.localStorage.getItem("rentify.recently-viewed.v1") ?? "{}",
        ).entries[0].id,
      ).toBe("posting-new");
    });

    // The provider lives in the root layout, so it stays mounted across
    // client-side navigation. A view recorded on a posting page has to show up
    // when the visitor then navigates to a page that renders the row.
    it("re-hydrates a signed-out list after a new view", async () => {
      anonymous();
      renderProvider();
      await waitFor(() =>
        expect(screen.getByTestId("status")).toHaveTextContent("ready"),
      );

      batchPublicMock.mockResolvedValue({
        postings: [makePosting("posting-new")],
        missingIds: [],
      });

      await userEvent.click(screen.getByRole("button", { name: "record" }));

      await waitFor(() =>
        expect(screen.getByTestId("ids")).toHaveTextContent("posting-new"),
      );
    });

    it("re-reads a signed-in list after a new view", async () => {
      authenticated();
      renderProvider();
      await waitFor(() =>
        expect(screen.getByTestId("status")).toHaveTextContent("ready"),
      );
      expect(listMock).toHaveBeenCalledTimes(1);

      listMock.mockResolvedValue({
        postings: [makePosting("posting-new")],
        trackingEnabled: true,
      });

      await userEvent.click(screen.getByRole("button", { name: "record" }));

      await waitFor(() =>
        expect(screen.getByTestId("ids")).toHaveTextContent("posting-new"),
      );
      // Re-read, not re-synced: the mirror is already in step with the account.
      expect(syncMock).not.toHaveBeenCalled();
    });

    it("records nothing at all once tracking is off", async () => {
      setTrackingEnabled(false);
      anonymous();
      renderProvider();
      await waitFor(() =>
        expect(screen.getByTestId("status")).toHaveTextContent("ready"),
      );

      await userEvent.click(screen.getByRole("button", { name: "record" }));

      expect(recordViewMock).not.toHaveBeenCalled();
      expect(
        window.localStorage.getItem("rentify.recently-viewed.v1"),
      ).toBeNull();
    });
  });

  describe("removing and clearing", () => {
    it("removes locally and on the server", async () => {
      recordLocalView("posting-a", 2000);
      authenticated();
      syncMock.mockResolvedValue({
        postings: [makePosting("posting-a")],
        trackingEnabled: true,
      });

      renderProvider();
      await waitFor(() =>
        expect(screen.getByTestId("ids")).toHaveTextContent("posting-a"),
      );

      await userEvent.click(screen.getByRole("button", { name: "remove" }));

      expect(removeMock).toHaveBeenCalledWith("posting-a");
      await waitFor(() =>
        expect(screen.getByTestId("ids")).toHaveTextContent(""),
      );
    });

    it("does not call the server for a signed-out visitor", async () => {
      recordLocalView("posting-a", 2000);
      anonymous();
      batchPublicMock.mockResolvedValue({
        postings: [makePosting("posting-a")],
        missingIds: [],
      });

      renderProvider();
      await waitFor(() =>
        expect(screen.getByTestId("ids")).toHaveTextContent("posting-a"),
      );

      await userEvent.click(screen.getByRole("button", { name: "remove" }));

      expect(removeMock).not.toHaveBeenCalled();
      expect(
        JSON.parse(
          window.localStorage.getItem("rentify.recently-viewed.v1") ?? "{}",
        ).entries,
      ).toEqual([]);
    });

    it("toasts and reloads when a removal fails", async () => {
      recordLocalView("posting-a", 2000);
      authenticated();
      syncMock.mockResolvedValue({
        postings: [makePosting("posting-a")],
        trackingEnabled: true,
      });
      removeMock.mockRejectedValue(new Error("offline"));

      renderProvider();
      await waitFor(() =>
        expect(screen.getByTestId("ids")).toHaveTextContent("posting-a"),
      );

      await userEvent.click(screen.getByRole("button", { name: "remove" }));

      await waitFor(() => expect(showErrorMock).toHaveBeenCalled());
      expect(showErrorMock.mock.calls[0][0].tone).toBe("error");
    });

    it("clears locally and on the server", async () => {
      authenticated();
      listMock.mockResolvedValue({
        postings: [makePosting("posting-a")],
        trackingEnabled: true,
      });

      renderProvider();
      await waitFor(() =>
        expect(screen.getByTestId("ids")).toHaveTextContent("posting-a"),
      );

      await userEvent.click(screen.getByRole("button", { name: "clear" }));

      expect(clearMock).toHaveBeenCalled();
      await waitFor(() =>
        expect(screen.getByTestId("ids")).toHaveTextContent(""),
      );
    });

    it("toasts when clearing fails", async () => {
      authenticated();
      clearMock.mockRejectedValue(new Error("offline"));

      renderProvider();
      await waitFor(() =>
        expect(screen.getByTestId("status")).toHaveTextContent("ready"),
      );

      await userEvent.click(screen.getByRole("button", { name: "clear" }));

      await waitFor(() => expect(showErrorMock).toHaveBeenCalled());
    });
  });

  it("refuses to be used outside the provider", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    expect(() => render(<Consumer />)).toThrow(
      /must be used within a RecentlyViewedProvider/,
    );

    consoleError.mockRestore();
  });
});
