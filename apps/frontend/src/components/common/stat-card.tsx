import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface StatCardProps {
  label: string;
  value?: string;
  hint?: string;
  icon: LucideIcon;
  loading?: boolean;
}

export function StatCard({ label, value, hint, icon: Icon, loading }: StatCardProps) {
  return (
    <Card size="sm">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardDescription>{label}</CardDescription>
        <Icon className="size-4 text-muted-foreground" aria-hidden />
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-24" data-testid="stat-skeleton" />
        ) : (
          <p className="text-2xl font-semibold tabular-nums">{value}</p>
        )}
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
