import { Bot, CircleX, Clock, Gauge, Inbox, MessageCircle, MessagesSquare, Send } from "lucide-react";
import { StatCard } from "@/components/common/stat-card";
import { formatDuration, formatNumber, formatPercent } from "@/lib/format";
import type { DashboardOverview } from "@/types/api";

export function OverviewStats({ totals }: { totals?: DashboardOverview["totals"] }) {
  const loading = !totals;
  const n = (v?: number) => (v === undefined ? undefined : formatNumber(v));
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      <StatCard label="Incoming messages" value={n(totals?.incoming)} icon={Inbox} loading={loading} />
      <StatCard label="Outgoing messages" value={n(totals?.outgoing)} icon={Send} loading={loading} />
      <StatCard label="Conversations" value={n(totals?.conversations)} icon={MessagesSquare} loading={loading} />
      <StatCard
        label="Active conversations"
        value={n(totals?.activeConversations)}
        hint="Open, with activity in the last 24 h"
        icon={MessageCircle}
        loading={loading}
      />
      <StatCard label="AI-generated replies" value={n(totals?.aiReplies)} icon={Bot} loading={loading} />
      <StatCard label="Failed messages" value={n(totals?.failedMessages)} icon={CircleX} loading={loading} />
      <StatCard
        label="AI success rate"
        value={totals && formatPercent(totals.aiSuccessRate)}
        hint="Inference requests that produced a reply"
        icon={Gauge}
        loading={loading}
      />
      <StatCard
        label="Avg. response time"
        value={totals && formatDuration(totals.avgResponseTimeMs)}
        hint="Customer message → AI reply sent"
        icon={Clock}
        loading={loading}
      />
    </div>
  );
}
