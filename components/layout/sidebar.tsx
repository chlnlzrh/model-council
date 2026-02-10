"use client";

import { useTheme } from "next-themes";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Moon, Sun, Plus, MessageSquare, Settings, BarChart3, MessageCircleQuestion, LogOut } from "lucide-react";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getModeDefinition } from "@/lib/council/modes/index";
import { UsageBadge } from "@/components/council/usage-badge";

interface SidebarProps {
  conversations: { id: string; title: string; mode?: string }[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}

export function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
}: SidebarProps) {
  const { theme, setTheme } = useTheme();
  const pathname = usePathname();

  return (
    <div className="flex h-full w-[260px] flex-col border-r border-border bg-muted/30">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold">Model Council</span>
          <UsageBadge />
        </div>
        <Button variant="secondary" size="sm" className="h-7 text-xs" onClick={onNew}>
          <Plus className="mr-1 h-3 w-3" />
          New
        </Button>
      </div>

      {/* Conversations */}
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Recent
        </div>
        {conversations.length === 0 && (
          <p className="px-2 py-4 text-xs text-muted-foreground">
            No conversations yet
          </p>
        )}
        {conversations.map((c) => (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            aria-current={activeId === c.id ? "page" : undefined}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              activeId === c.id
                ? "bg-accent text-accent-foreground font-medium"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            )}
          >
            <MessageSquare className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{c.title}</span>
            {c.mode && c.mode !== "council" && (
              <span className="ml-auto flex-shrink-0 text-[9px] text-muted-foreground">
                {getModeDefinition(c.mode)?.name ?? c.mode}
              </span>
            )}
          </button>
        ))}

        <div className="mt-4 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Navigation
        </div>
        <Link
          href="/settings"
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-2 text-xs transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            pathname === "/settings"
              ? "bg-accent text-accent-foreground font-medium"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          )}
        >
          <Settings className="h-3 w-3" />
          Settings
        </Link>
        <Link
          href="/analytics"
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-2 text-xs transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            pathname === "/analytics"
              ? "bg-accent text-accent-foreground font-medium"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          )}
        >
          <BarChart3 className="h-3 w-3" />
          Analytics
        </Link>
        <Link
          href="/feedback"
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-2 text-xs transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            pathname === "/feedback"
              ? "bg-accent text-accent-foreground font-medium"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          )}
        >
          <MessageCircleQuestion className="h-3 w-3" />
          Feedback
        </Link>
      </nav>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-border px-4 py-3">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-[10px] text-muted-foreground gap-1 px-1"
          onClick={() => signOut({ callbackUrl: "/login" })}
        >
          <LogOut className="h-3 w-3" />
          Sign out
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          <Sun className="h-3 w-3 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-3 w-3 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </div>
    </div>
  );
}
