"use client";

import { ErrorState } from "@/components/common/states";
import { PageHeader } from "@/components/common/page-header";
import { MessagesChart } from "@/components/dashboard/messages-chart";
import { ModelStatus, RecentConversations, RecentErrors } from "@/components/dashboard/overview-panels";
import { OverviewStats } from "@/components/dashboard/overview-stats";
import { SystemStatusList } from "@/components/system-status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useDashboardOverview } from "@/hooks/queries";

export default function OverviewPage() {
  const { data, isError, error, refetch } = useDashboardOverview();

  return (
    <>
      <PageHeader title="Overview" description="Messages, conversations and AI activity at a glance" />
      {isError ? (
        <Card>
          <ErrorState message={error.message} onRetry={() => refetch()} />
        </Card>
      ) : (
        <OverviewStats totals={data?.totals} />
      )}
      <MessagesChart />
      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Recent conversations" className="lg:col-span-2">
          {data ? <RecentConversations items={data.recentConversations} /> : <ListSkeleton />}
        </Panel>
        <Panel title="AI model">{data ? <ModelStatus model={data.activeModel} /> : <ListSkeleton />}</Panel>
        <Panel title="Recent errors" className="lg:col-span-2">
          {data ? <RecentErrors items={data.recentErrors} /> : <ListSkeleton />}
        </Panel>
        <Panel title="System health">
          <SystemStatusList />
        </Panel>
      </div>
    </>
  );
}

function Panel({ title, className, children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}
