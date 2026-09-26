// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const generateLink = vi.hoisted(() => vi.fn());
vi.mock("@/app/actions/admin-recovery-actions", () => ({
  generateMemberRecoveryLinkAction: generateLink,
}));

import { AccountRecoveryMenu } from "./account-recovery-menu";

const profileId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003";
const recoveryLink =
  "https://portal.example.edu/auth/confirm?type=recovery&token_hash=secret-token";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("admin recovery menu", () => {
  it("requires confirmation, copies the generated link, and clears it when closed", async () => {
    generateLink.mockResolvedValue({ link: recoveryLink, recipientEmail: "member@example.edu" });
    const copy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: copy },
    });

    render(
      <AccountRecoveryMenu
        accountName="Morgan Member"
        recoveryTarget={{ profileId, email: "member@example.edu" }}
      >
        <span>Other action</span>
      </AccountRecoveryMenu>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Account actions for Morgan Member" }));
    fireEvent.click(await screen.findByText("Generate reset link"));
    expect(screen.getByRole("dialog")).toHaveTextContent("member@example.edu");

    const generate = screen.getByRole("button", { name: "Generate reset link" });
    expect(generate).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(generate).toBeEnabled();
    fireEvent.click(generate);

    await waitFor(() => expect(screen.getByRole("button", { name: "Copy link" })).toBeVisible());
    expect(generateLink).toHaveBeenCalledOnce();
    expect((generateLink.mock.calls[0]?.[1] as FormData).get("profile_id")).toBe(profileId);
    expect((generateLink.mock.calls[0]?.[1] as FormData).get("expected_email")).toBe(
      "member@example.edu",
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(copy).toHaveBeenCalledExactlyOnceWith(recoveryLink));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Account actions for Morgan Member" }));
    fireEvent.click(await screen.findByText("Generate reset link"));
    expect(screen.queryByDisplayValue(recoveryLink)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate reset link" })).toBeDisabled();
  });
});
