"use client";

import { Bot } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { NAV_SECTIONS } from "./nav";

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { can } = useAuth();

  return (
    <div className="flex h-full flex-col">
      <Link href="/" onClick={onNavigate} className="flex h-14 items-center gap-2 border-b px-5 font-semibold">
        <Bot className="size-5 text-primary" aria-hidden />
        My Own AI
      </Link>
      <nav aria-label="Main" className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {NAV_SECTIONS.map((section) => {
          const items = section.items.filter((item) => can(item.permission));
          if (items.length === 0) return null;
          return (
            <div key={section.title}>
              <p className="mb-1 px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{section.title}</p>
              <ul className="space-y-0.5">
                {items.map(({ href, label, icon: Icon, phase }) => {
                  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
                          active
                            ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                            : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                        )}
                      >
                        <Icon className="size-4" aria-hidden />
                        <span className="flex-1">{label}</span>
                        {phase && <span className="text-[10px] text-muted-foreground/70">P{phase}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
    </div>
  );
}
