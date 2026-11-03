import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarNav } from "./sidebar-nav";

const auth = vi.hoisted(() => ({ permissions: [] as string[] }));

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    can: (p: string) => auth.permissions.includes("*") || auth.permissions.includes(p),
  }),
}));

describe("SidebarNav", () => {
  beforeEach(() => {
    auth.permissions = [];
  });

  it("shows every section to an admin", () => {
    auth.permissions = ["*"];
    render(<SidebarNav />);
    for (const label of ["Overview", "Inbox", "Models", "System logs", "Users & security"]) {
      expect(screen.getByRole("link", { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  it("hides items the role cannot access", () => {
    auth.permissions = ["dashboard:read", "messages:read", "usage:read"];
    render(<SidebarNav />);

    expect(screen.getByRole("link", { name: /Overview/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /System logs/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Users & security/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Settings")).not.toBeInTheDocument();
  });

  it("marks the current page", () => {
    auth.permissions = ["*"];
    render(<SidebarNav />);
    expect(screen.getByRole("link", { name: /Overview/ })).toHaveAttribute("aria-current", "page");
  });
});
