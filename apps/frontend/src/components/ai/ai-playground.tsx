"use client";

import { useMutation } from "@tanstack/react-query";
import { LoaderCircle, Send } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDuration } from "@/lib/format";
import { api } from "@/services/api";
import type { AiDecisionResult } from "@/types/api";

const ACTION_LABEL: Record<AiDecisionResult["action"], { label: string; variant: "secondary" | "outline" | "destructive" }> = {
  reply: { label: "Model reply", variant: "secondary" },
  fallback: { label: "Fallback: reply rejected", variant: "outline" },
  handoff: { label: "Handed to staff", variant: "destructive" },
};

/** Try a customer message against the live pipeline. Nothing is sent to WhatsApp. */
export function AiPlayground() {
  const [text, setText] = useState("");
  const test = useMutation({
    mutationFn: (message: string) => api.post<AiDecisionResult>("/ai/test", { messages: [{ role: "customer", text: message }] }),
  });
  const result = test.data;

  return (
    <div className="space-y-4">
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) test.mutate(text.trim());
        }}
      >
        <Label htmlFor="playground-message">Customer message</Label>
        <Textarea id="playground-message" rows={2} maxLength={4096} placeholder="How much is a blood test?" value={text} onChange={(e) => setText(e.target.value)} />
        <Button type="submit" disabled={!text.trim() || test.isPending}>
          {test.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
          Try it
        </Button>
      </form>
      {test.isError && (
        <p role="alert" className="text-sm text-destructive">
          {test.error.message}
        </p>
      )}
      {result && (
        <div className="space-y-3 rounded-lg border p-4" aria-live="polite">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={ACTION_LABEL[result.action].variant}>{ACTION_LABEL[result.action].label}</Badge>
            <span className="text-xs text-muted-foreground">
              {result.reason.replaceAll("_", " ")}
              {result.detail && ` (${result.detail})`}
              {result.confidence !== null && ` · confidence ${result.confidence.toFixed(2)}`} · {formatDuration(result.latency_ms)}
            </span>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">The customer would receive</p>
            <p className="text-sm">{result.text}</p>
          </div>
          {result.model_text !== null && result.model_text !== result.text && (
            <div>
              <p className="text-xs text-muted-foreground">The model wrote (not sent)</p>
              <p className="text-sm text-muted-foreground italic">{result.model_text || "(nothing)"}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
