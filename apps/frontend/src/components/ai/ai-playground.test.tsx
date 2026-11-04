import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AiPlayground } from "./ai-playground";

const api = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("@/services/api", () => ({ api }));

describe("AiPlayground", () => {
  it("shows what the customer would get and the rejected model text", async () => {
    api.post.mockResolvedValue({
      action: "fallback",
      text: "A team member will get back to you shortly.",
      reason: "ungrounded",
      detail: "name",
      handoff_required: true,
      confidence: 0.23,
      model_text: "Thank you, Anna. I have passed your request…",
      usage: { input_tokens: 18, output_tokens: 29 },
      latency_ms: 185,
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AiPlayground />
      </QueryClientProvider>,
    );

    await userEvent.type(screen.getByLabelText("Customer message"), "Can you recommend a restaurant?");
    await userEvent.click(screen.getByRole("button", { name: "Try it" }));

    expect(api.post).toHaveBeenCalledWith("/ai/test", { messages: [{ role: "customer", text: "Can you recommend a restaurant?" }] });
    expect(await screen.findByText("Fallback: reply rejected")).toBeInTheDocument();
    expect(screen.getByText("A team member will get back to you shortly.")).toBeInTheDocument();
    expect(screen.getByText(/Thank you, Anna/)).toBeInTheDocument();
    expect(screen.getByText(/ungrounded \(name\) · confidence 0.23/)).toBeInTheDocument();
  });
});
