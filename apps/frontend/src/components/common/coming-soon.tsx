import { Construction } from "lucide-react";
import { findNavItem } from "@/components/layout/nav";
import { Card } from "@/components/ui/card";
import { EmptyState } from "./states";
import { PageHeader } from "./page-header";

/** Placeholder for pages delivered in a later development phase. */
export function ComingSoon({ href }: { href: string }) {
  const item = findNavItem(href);
  return (
    <>
      <PageHeader title={item?.label ?? "Coming soon"} />
      <Card>
        <EmptyState
          icon={Construction}
          title="Not built yet"
          description={item?.phase ? `This page is delivered in Phase ${item.phase} of the development plan.` : undefined}
        />
      </Card>
    </>
  );
}
