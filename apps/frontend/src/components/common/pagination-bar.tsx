import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import type { PageMeta } from "@/types/api";

export function PaginationBar({ meta, onPage }: { meta: PageMeta; onPage: (page: number) => void }) {
  if (meta.total === 0) return null;
  const first = (meta.page - 1) * meta.pageSize + 1;
  const last = Math.min(meta.page * meta.pageSize, meta.total);
  return (
    <div className="flex items-center justify-between gap-2 pt-3 text-sm text-muted-foreground">
      <span>
        {formatNumber(first)}–{formatNumber(last)} of {formatNumber(meta.total)}
      </span>
      <div className="flex gap-1">
        <Button variant="outline" size="icon-sm" onClick={() => onPage(meta.page - 1)} disabled={meta.page <= 1} aria-label="Previous page">
          <ChevronLeft />
        </Button>
        <Button variant="outline" size="icon-sm" onClick={() => onPage(meta.page + 1)} disabled={meta.page >= meta.totalPages} aria-label="Next page">
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
