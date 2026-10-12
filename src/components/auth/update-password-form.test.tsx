// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const updatePassword = vi.hoisted(() => vi.fn());
vi.mock("@/app/actions/auth-actions", () => ({ updatePasswordAction: updatePassword }));

import { UpdatePasswordForm } from "./update-password-form";

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("password form recovery", () => {
  it("keeps entered values after rejection and lets the user correct and resubmit", async () => {
    updatePassword
      .mockResolvedValueOnce({
        fieldErrors: { password: ["Choose a different password from your current one."] },
      })
      .mockResolvedValueOnce({ message: "Password saved." });
    render(<UpdatePasswordForm />);
    const password = screen.getByLabelText("New password");
    const confirmation = screen.getByLabelText("Confirm password");
    fireEvent.change(password, { target: { value: "reused" } });
    fireEvent.change(confirmation, { target: { value: "reused" } });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));
    await screen.findByText("Choose a different password from your current one.");
    expect(password).toHaveValue("reused");
    expect(confirmation).toHaveValue("reused");
    expect(
      screen.queryByRole("link", { name: "Request a new reset link" }),
    ).not.toBeInTheDocument();
    fireEvent.change(password, { target: { value: "abcdef" } });
    fireEvent.change(confirmation, { target: { value: "abcdef" } });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));
    await screen.findByText("Password saved.");
    expect(updatePassword).toHaveBeenCalledTimes(2);
    expect((updatePassword.mock.calls[1]?.[1] as FormData).get("password")).toBe("abcdef");
  });

  it("offers a fresh-link path and stops further submissions for an expired context", async () => {
    updatePassword.mockResolvedValue({
      error: "Your password setup session has expired.",
      requiresNewPasswordLink: true,
    });
    render(<UpdatePasswordForm />);
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "abcdef" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "abcdef" } });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Request a new reset link" })).toHaveAttribute(
        "href",
        "/forgot-password",
      ),
    );
    expect(screen.getByRole("button", { name: "Update password" })).toBeDisabled();
  });
});
