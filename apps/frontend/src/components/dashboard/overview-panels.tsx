import { Brain, CircleCheck, MessageCircle } from "lucide-react";
import { EmptyState } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { formatNumber, formatRelative } from "@/lib/format";
import type { DashboardOverview } from "@/types/api";

export function RecentConversations({ items }: { items: DashboardOverview["recentConversations"] }) {
  if (items.length === 0) {
    return <EmptyState icon={MessageCircle} title="No conversations yet" description="Customer chats appear here once WhatsApp is connected." />;
  }
  return (
    <ul className="divide-y">
      {items.map((c) => (
        <li key={c.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{c.customerName ?? `+${c.customerWaId}`}</p>
            <p className="truncate text-xs text-muted-foreground">{c.lastMessagePreview ?? "—"}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="text-xs text-muted-foreground">{formatRelative(c.lastMessageAt)}</span>
            <div className="flex gap-1">
              {c.status === "HUMAN" && <Badge variant="outline">Human</Badge>}
              {!c.aiEnabled && <Badge variant="secondary">AI off</Badge>}
              {c.unreadCount > 0 && <Badge>{c.unreadCount}</Badge>}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function RecentErrors({ items }: { items: DashboardOverview["recentErrors"] }) {
  if (items.length === 0) {
    return <EmptyState icon={CircleCheck} title="No recent errors" description="Errors from the backend, webhooks and AI service show up here." />;
  }
  return (
    <ul className="divide-y">
      {items.map((e) => (
        <li key={e.id} className="py-2.5 first:pt-0 last:pb-0">
          <div className="flex items-center justify-between gap-2">
            <code className="truncate text-xs">{e.event}</code>
            <span className="shrink-0 text-xs text-muted-foreground">{formatRelative(e.createdAt)}</span>
          </div>
          <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
            <Badge variant="outline" className="mr-1.5">
              {e.category}
            </Badge>
            {e.message}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function ModelStatus({ model }: { model: DashboardOverview["activeModel"] }) {
  if (!model) {
    return (
      <EmptyState
        icon={Brain}
        title="No active model"
        description="Train a model from scratch (Phases 6–8) and activate a version to enable AI replies."
      />
    );
  }
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
      <div>
        <dt className="text-xs text-muted-foreground">Model</dt>
        <dd className="font-medium">{model.name}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Version</dt>
        <dd className="font-medium">v{model.version}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Parameters</dt>
        <dd className="font-medium tabular-nums">{formatNumber(model.parameterCount)}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Context length</dt>
        <dd className="font-medium tabular-nums">{model.contextLength} tokens</dd>
      </div>
      <div className="col-span-2">
        <dt className="text-xs text-muted-foreground">Activated</dt>
        <dd className="font-medium">{formatRelative(model.activatedAt)}</dd>
      </div>
    </dl>
  );
}
