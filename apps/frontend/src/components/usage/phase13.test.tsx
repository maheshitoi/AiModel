import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaginationBar } from "@/components/common/pagination-bar";
import { UserDialog } from "@/components/users/user-dialog";
import type { UserRow } from "@/types/api";
import { BarList } from "./usage-charts";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock("@/services/api", () => ({ api }));

describe("BarList", () => {
  it("shows every value as text and scales bars to the largest", () => {
    const { container } = render(<BarList empty="none" rows={[{ label: "Approved", value: 10 }, { label: "Dismissed", value: 5 }]} />);
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    const widths = [...container.querySelectorAll("span[style]")].map((el) => (el as HTMLElement).style.width);
    expect(widths).toEqual(["100%", "50%"]);
  });

  it("says so when there is nothing to show", () => {
    render(<BarList empty="No AI decisions in this period." rows={[{ label: "A", value: 0 }]} />);
    expect(screen.getByText("No AI decisions in this period.")).toBeInTheDocument();
  });
});

describe("PaginationBar", () => {
  it("shows the range and disables buttons at the ends", async () => {
    const onPage = vi.fn();
    render(<PaginationBar meta={{ page: 1, pageSize: 25, total: 60, totalPages: 3 }} onPage={onPage} />);
    expect(screen.getByText("1–25 of 60")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(onPage).toHaveBeenCalledWith(2);
  });
});

describe("UserDialog", () => {
  const user: UserRow = {
    id: "u1",
    email: "op@example.com",
    name: "Operator",
    isActive: true,
    lastLoginAt: null,
    lockedUntil: null,
    createdAt: "2026-11-01T00:00:00Z",
    role: { id: "r-op", name: "OPERATOR" },
  };
  const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

  beforeEach(() => {
    api.get.mockReset().mockResolvedValue([{ id: "r-op", name: "OPERATOR", description: "Handles conversations", permissions: [] }]);
    api.patch.mockReset().mockResolvedValue({});
    api.post.mockReset().mockResolvedValue({});
  });

  it("does not send an empty password when editing", async () => {
    wrap(<UserDialog open onOpenChange={vi.fn()} user={user} />);
    await userEvent.clear(screen.getByLabelText("Name"));
    await userEvent.type(screen.getByLabelText("Name"), "Operator One");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(api.patch).toHaveBeenCalledWith("/users/u1", { name: "Operator One", roleId: "r-op", isActive: true });
  });

  it("requires a strong enough password for new users", async () => {
    wrap(<UserDialog open onOpenChange={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Name"), "New");
    await userEvent.type(screen.getByLabelText("Email"), "new@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "short");
    await userEvent.click(screen.getByRole("button", { name: "Add user" }));
    expect(await screen.findByText("Use at least 12 characters")).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("hides the active switch on your own account", () => {
    wrap(<UserDialog open onOpenChange={vi.fn()} user={user} isSelf />);
    expect(screen.queryByLabelText("Active")).not.toBeInTheDocument();
  });
});
