import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OverviewStats } from "./overview-stats";

describe("OverviewStats", () => {
  it("shows skeletons while loading", () => {
    render(<OverviewStats />);
    expect(screen.getAllByTestId("stat-skeleton")).toHaveLength(8);
  });

  it("renders formatted totals", () => {
    render(
      <OverviewStats
        totals={{
          incoming: 1234,
          outgoing: 1100,
          conversations: 87,
          activeConversations: 12,
          aiReplies: 950,
          failedMessages: 3,
          aiSuccessRate: 0.987,
          avgResponseTimeMs: 2450,
        }}
      />,
    );

    expect(screen.getByText("1,234")).toBeInTheDocument();
    expect(screen.getByText("98.7%")).toBeInTheDocument();
    expect(screen.getByText("2.5 s")).toBeInTheDocument();
    expect(screen.queryByTestId("stat-skeleton")).not.toBeInTheDocument();
  });

  it("shows a dash when rates are not available yet", () => {
    render(
      <OverviewStats
        totals={{
          incoming: 0,
          outgoing: 0,
          conversations: 0,
          activeConversations: 0,
          aiReplies: 0,
          failedMessages: 0,
          aiSuccessRate: null,
          avgResponseTimeMs: null,
        }}
      />,
    );
    expect(screen.getAllByText("—")).toHaveLength(2);
  });
});
