import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WhatsAppAccount } from "@/types/api";
import { AccountFormDialog } from "./account-form-dialog";

const api = vi.hoisted(() => ({ post: vi.fn(), patch: vi.fn() }));
vi.mock("@/services/api", async (original) => ({ ...(await original<typeof import("@/services/api")>()), api }));

const account: WhatsAppAccount = {
  id: "acc-1",
  displayName: "Clinic",
  phoneNumber: "+15550102030",
  phoneNumberId: "109876543210",
  businessAccountId: "200000000001",
  accessTokenLast4: "WXYZ",
  status: "CONNECTED",
  autoReplyEnabled: false,
  lastVerifiedAt: null,
  lastWebhookAt: null,
  createdAt: "2026-11-03T00:00:00Z",
};

function renderDialog(props: Partial<Parameters<typeof AccountFormDialog>[0]> = {}) {
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AccountFormDialog open onOpenChange={onOpenChange} {...props} />
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

describe("AccountFormDialog", () => {
  beforeEach(() => {
    api.post.mockReset().mockResolvedValue({});
    api.patch.mockReset().mockResolvedValue({});
  });

  it("requires every credential when connecting a number", async () => {
    renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByText("Access token must be at least 20 characters")).toBeInTheDocument();
    expect(screen.getByText("Use E.164 format, e.g. +15550102030")).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("never pre-fills secrets and omits empty ones when editing", async () => {
    const { onOpenChange } = renderDialog({ account });
    const token = screen.getByLabelText("Access token");
    expect(token).toHaveValue("");
    expect(token).toHaveAttribute("type", "password");
    expect(token).toHaveAttribute("placeholder", "•••• WXYZ");

    await userEvent.clear(screen.getByLabelText("Name"));
    await userEvent.type(screen.getByLabelText("Name"), "Clinic HQ");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(api.patch).toHaveBeenCalledWith("/whatsapp/accounts/acc-1", {
      displayName: "Clinic HQ",
      phoneNumber: "+15550102030",
      phoneNumberId: "109876543210",
      businessAccountId: "200000000001",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("sends a new secret only when one is entered", async () => {
    renderDialog({ account });
    await userEvent.type(screen.getByLabelText("App secret"), "a-brand-new-app-secret");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(api.patch.mock.calls[0][1]).toMatchObject({ appSecret: "a-brand-new-app-secret" });
    expect(api.patch.mock.calls[0][1]).not.toHaveProperty("accessToken");
  });
});
