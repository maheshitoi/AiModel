import {
  Activity,
  Brain,
  ChartColumn,
  Database,
  LayoutDashboard,
  MessageCircle,
  MessagesSquare,
  Phone,
  ScrollText,
  SlidersHorizontal,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Hidden from users whose role lacks this permission (the API enforces it regardless). */
  permission: string;
  /** Development phase that delivers the page; undefined once it exists. */
  phase?: number;
}

export const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: "Monitor",
    items: [
      { href: "/", label: "Overview", icon: LayoutDashboard, permission: "dashboard:read" },
      { href: "/inbox", label: "Inbox", icon: MessageCircle, permission: "conversations:read" },
      { href: "/messages", label: "Messages", icon: MessagesSquare, permission: "messages:read" },
    ],
  },
  {
    title: "AI",
    items: [
      { href: "/models", label: "Models", icon: Brain, permission: "models:read" },
      { href: "/training", label: "Training", icon: Activity, permission: "training:read" },
      { href: "/datasets", label: "Datasets", icon: Database, permission: "datasets:read" },
    ],
  },
  {
    title: "Insights",
    items: [
      { href: "/usage", label: "Usage", icon: ChartColumn, permission: "usage:read" },
      { href: "/logs", label: "System logs", icon: ScrollText, permission: "logs:read" },
    ],
  },
  {
    title: "Settings",
    items: [
      { href: "/settings/whatsapp", label: "WhatsApp", icon: Phone, permission: "settings:read" },
      { href: "/settings/ai", label: "AI settings", icon: SlidersHorizontal, permission: "settings:read" },
      { href: "/users", label: "Users & security", icon: Users, permission: "users:manage" },
    ],
  },
];

export const findNavItem = (href: string) => NAV_SECTIONS.flatMap((s) => s.items).find((i) => i.href === href);
