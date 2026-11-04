"use client";

import { Check, CheckCheck, CircleAlert, Clock, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { InboxMessage, MessageStatus } from "@/types/api";

const STATUS: Partial<Record<MessageStatus, { icon: typeof Check; label: string; className?: string }>> = {
  QUEUED: { icon: Clock, label: "Waiting to send" },
  SENDING: { icon: Clock, label: "Sending" },
  SENT: { icon: Check, label: "Sent" },
  DELIVERED: { icon: CheckCheck, label: "Delivered" },
  READ: { icon: CheckCheck, label: "Read", className: "text-primary" },
  FAILED: { icon: CircleAlert, label: "Not delivered", className: "text-destructive" },
};

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

function content(m: InboxMessage): string {
  if (m.type === "TEXT") return m.body ?? "";
  const kind = m.type.toLowerCase();
  return m.body ? `[${kind}] ${m.body}` : `[${kind}]`;
}

export function MessageBubble({ message: m, onRetry, retrying }: { message: InboxMessage; onRetry?: () => void; retrying?: boolean }) {
  const outbound = m.direction === "OUTBOUND";
  const status = outbound ? STATUS[m.status] : undefined;
  const author = !outbound ? null : m.source === "AI" ? "AI" : (m.sentBy?.name ?? "Staff");

  return (
    <div className={cn("flex", outbound ? "justify-end" : "justify-start")}>
      <div className="max-w-[85%] space-y-1 sm:max-w-[70%]">
        <div
          className={cn(
            "rounded-2xl px-3 py-2 text-sm break-words whitespace-pre-wrap",
            outbound ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm bg-muted",
            m.type !== "TEXT" && "italic",
          )}
        >
          {content(m)}
        </div>
        <div className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", outbound && "justify-end")}>
          {author && <span>{author} ·</span>}
          <time dateTime={m.occurredAt} title={formatDateTime(m.occurredAt)}>
            {time(m.occurredAt)}
          </time>
          {status && (
            <span className={cn("inline-flex items-center gap-0.5", status.className)}>
              <status.icon className="size-3.5" aria-hidden />
              <span className="sr-only sm:not-sr-only">{status.label}</span>
            </span>
          )}
        </div>
        {m.status === "FAILED" && (
          <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-destructive">
            <span>{m.errorMessage ?? "WhatsApp did not accept this message."}</span>
            {onRetry && (
              <Button variant="outline" size="xs" onClick={onRetry} disabled={retrying}>
                <RotateCcw aria-hidden />
                Retry
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
