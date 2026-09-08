import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UsernameSuggestions } from "./username-suggestions";

const { getUsernameSuggestionsMock } = vi.hoisted(() => ({
  getUsernameSuggestionsMock: vi.fn(),
}));

vi.mock("@/lib/auth/api", () => ({
  authApi: {
    getUsernameSuggestions: getUsernameSuggestionsMock,
  },
}));

describe("UsernameSuggestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUsernameSuggestionsMock.mockResolvedValue({
      suggestions: [
        "bright-otter-4827",
        "calm-willow-1034",
        "swift-comet-9261",
      ],
    });
  });

  it("loads three suggestions and reports the selected username", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<UsernameSuggestions onSelect={onSelect} />);

    expect(
      screen.getByText("Finding available usernames..."),
    ).toBeInTheDocument();
    await user.click(
      await screen.findByRole("button", {
        name: "Use username calm-willow-1034",
      }),
    );

    expect(getUsernameSuggestionsMock).toHaveBeenCalledWith(
      3,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(onSelect).toHaveBeenCalledWith("calm-willow-1034");
  });

  it("replaces suggestions when refreshed", async () => {
    const user = userEvent.setup();
    getUsernameSuggestionsMock
      .mockResolvedValueOnce({ suggestions: ["bright-otter-4827"] })
      .mockResolvedValueOnce({ suggestions: ["merry-harbor-2048"] });
    render(<UsernameSuggestions onSelect={vi.fn()} />);

    await screen.findByText("bright-otter-4827");
    await user.click(
      screen.getByRole("button", { name: "Refresh username suggestions" }),
    );

    expect(await screen.findByText("merry-harbor-2048")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("bright-otter-4827")).not.toBeInTheDocument();
    });
  });

  it("keeps manual username entry available when loading fails", async () => {
    getUsernameSuggestionsMock.mockRejectedValue(new Error("offline"));
    render(<UsernameSuggestions onSelect={vi.fn()} />);

    expect(
      await screen.findByText(
        "Suggestions are unavailable right now. You can still choose your own username.",
      ),
    ).toBeInTheDocument();
  });
});
