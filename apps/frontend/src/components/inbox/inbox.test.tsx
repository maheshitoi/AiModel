import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiDecision, InboxMessage } from "@/types/api";
import { replyBlocker } from "./composer";
import { MessageBubble } from "./message-bubble";
import { SuggestionPanel } from "./suggestion-panel";

const api = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("@/services/api", () => ({ api }));

const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

describe("replyBlocker", () => {
  const now = Date.parse("2026-11-04T12:00:00Z");
  it("allows replies inside the 24-hour window", () => {
    expect(replyBlocker("2026-11-04T13:00:00Z", false, now)).toBeNull();
  });
  it("explains why a reply can't be sent", () => {
    expect(replyBlocker("2026-11-04T11:00:00Z", false, now)).toMatch(/24 hours/);
    expect(replyBlocker(null, false, now)).toMatch(/24 hours/);
    expect(replyBlocker("2026-11-04T13:00:00Z", true, now)).toMatch(/disabled/);
  });
});

const message = (over: Partial<InboxMessage>): InboxMessage => ({
  id: "m1",
  direction: "OUTBOUND",
  type: "TEXT",
  source: "AI",
  body: "Our hours are 9 to 5",
  mediaCaption: null,
  mediaMimeType: null,
  status: "READ",
  errorCode: null,
  errorMessage: null,
  retryCount: 0,
  occurredAt: "2026-11-04T10:00:00Z",
  sentBy: null,
  aiDecision: null,
  ...over,
});

describe("MessageBubble", () => {
  it("labels who sent an outbound message and its delivery state", () => {
    render(<MessageBubble message={message({})} />);
    expect(screen.getByText("Our hours are 9 to 5")).toBeInTheDocument();
    expect(screen.getByText(/AI ·/)).toBeInTheDocument();
    expect(screen.getByText("Read")).toBeInTheDocument();
  });

  it("shows WhatsApp's error and a retry button for failed messages", async () => {
    const onRetry = vi.fn();
    render(<MessageBubble message={message({ source: "HUMAN", sentBy: { id: "u", name: "Priya" }, status: "FAILED", errorMessage: "Message undeliverable" })} onRetry={onRetry} />);
    expect(screen.getByText(/Priya ·/)).toBeInTheDocument();
    expect(screen.getByText("Message undeliverable")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("marks non-text messages", () => {
    render(<MessageBubble message={message({ direction: "INBOUND", source: "CUSTOMER", type: "IMAGE", body: "my rash", status: "RECEIVED" })} />);
    expect(screen.getByText("[image] my rash")).toBeInTheDocument();
  });
});

describe("SuggestionPanel", () => {
  const decision: AiDecision = {
    id: "d1",
    conversationId: "c1",
    inboundMessageId: "m0",
    action: "REPLY",
    reason: "model_reply",
    detail: null,
    text: "A blood test costs $25.",
    modelText: "A blood test costs $25.",
    confidence: 0.91,
    handoffRequired: false,
    status: "SUGGESTED",
    createdAt: "2026-11-04T10:00:00Z",
  };
  beforeEach(() => api.post.mockReset().mockResolvedValue({}));

  it("sends the suggestion unchanged", async () => {
    wrap(<SuggestionPanel decision={decision} canReply />);
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(api.post).toHaveBeenCalledWith("/ai/decisions/d1/approve", {});
  });

  it("sends an edited reply", async () => {
    wrap(<SuggestionPanel decision={decision} canReply />);
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const box = screen.getByLabelText("Edit suggested reply");
    await userEvent.clear(box);
    await userEvent.type(box, "It's $25 and takes 10 minutes.");
    await userEvent.click(screen.getByRole("button", { name: "Send edited reply" }));
    expect(api.post).toHaveBeenCalledWith("/ai/decisions/d1/approve", { text: "It's $25 and takes 10 minutes." });
  });

  it("dismisses, and hides actions without reply permission", async () => {
    const { unmount } = wrap(<SuggestionPanel decision={decision} canReply />);
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(api.post).toHaveBeenCalledWith("/ai/decisions/d1/dismiss");
    unmount();
    wrap(<SuggestionPanel decision={decision} canReply={false} />);
    expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument();
  });

  it("shows the rejected model text for a fallback", () => {
    wrap(<SuggestionPanel decision={{ ...decision, action: "FALLBACK", reason: "ungrounded", text: "A team member will reply.", modelText: "Thank you, Anna." }} canReply />);
    expect(screen.getByText("AI reply had unsupported details")).toBeInTheDocument();
    expect(screen.getByText("Thank you, Anna.")).toBeInTheDocument();
  });
});
