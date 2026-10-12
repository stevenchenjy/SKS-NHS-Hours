// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const actions = vi.hoisted(() => ({ loginAction: vi.fn(), forgotPasswordAction: vi.fn() }));
vi.mock("@/app/actions/auth-actions", () => actions);
import { LoginForm } from "./login-form";
import { ForgotPasswordForm } from "./forgot-password-form";
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
describe("retryable sign-in forms", () => {
  it("retains credentials after failed sign-in and supports password visibility", async () => {
    actions.loginAction.mockResolvedValue({ error: "The password is incorrect." });
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("School email"), {
      target: { value: "member@example.edu" },
    });
    fireEvent.change(screen.getByLabelText("Password", { exact: true }), {
      target: { value: "abcdef" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByText("The password is incorrect.");
    expect(screen.getByLabelText("School email")).toHaveValue("member@example.edu");
    expect(screen.getByLabelText("Password", { exact: true })).toHaveValue("abcdef");
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(screen.getByLabelText("Password", { exact: true })).toHaveAttribute("type", "text");
  });
  it("retains the email after a sending-limit failure", async () => {
    actions.forgotPasswordAction.mockResolvedValue({ error: "Email sending is limited." });
    render(<ForgotPasswordForm />);
    fireEvent.change(screen.getByLabelText("School email"), {
      target: { value: "member@example.edu" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send reset instructions" }));
    await screen.findByText("Email sending is limited.");
    expect(screen.getByLabelText("School email")).toHaveValue("member@example.edu");
  });
});
