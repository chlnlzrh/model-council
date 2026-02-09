"use client";

import { useState, useCallback, useEffect } from "react";
import { useSession } from "next-auth/react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Sidebar } from "@/components/layout/sidebar";

interface Conversation {
  id: string;
  title: string;
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: session } = useSession();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Load conversations from DB
  useEffect(() => {
    if (!session?.user) return;
    fetch("/api/conversations")
      .then((res) => (res.ok ? res.json() : []))
      .then((data: Conversation[]) => setConversations(data))
      .catch(() => {});
  }, [session?.user]);

  const handleNew = useCallback(() => {
    const id = crypto.randomUUID();
    setConversations((prev) => [{ id, title: "New Council" }, ...prev]);
    setActiveId(id);
    setSidebarOpen(false);
  }, []);

  const handleSelect = useCallback((id: string) => {
    setActiveId(id);
    setSidebarOpen(false);
  }, []);

  const updateTitle = useCallback((id: string, title: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title } : c))
    );
  }, []);

  // When SSE creates a conversation, add it to the list
  const addConversation = useCallback((id: string, title: string) => {
    setConversations((prev) => {
      if (prev.some((c) => c.id === id)) {
        return prev.map((c) => (c.id === id ? { ...c, title } : c));
      }
      return [{ id, title }, ...prev];
    });
    setActiveId(id);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop sidebar */}
      <div className="hidden md:block">
        <Sidebar
          conversations={conversations}
          activeId={activeId}
          onSelect={handleSelect}
          onNew={handleNew}
        />
      </div>

      {/* Main */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Mobile header */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-2 md:hidden">
          <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                <Menu className="h-4 w-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[280px] p-0">
              <Sidebar
                conversations={conversations}
                activeId={activeId}
                onSelect={handleSelect}
                onNew={handleNew}
              />
            </SheetContent>
          </Sheet>
          <span className="text-xs font-bold">Model Council</span>
        </div>

        <DashboardContext.Provider
          value={{
            conversations,
            activeId,
            setActiveId,
            handleNew,
            updateTitle,
            addConversation,
          }}
        >
          {children}
        </DashboardContext.Provider>
      </div>
    </div>
  );
}

// Simple context for dashboard state
import { createContext, useContext } from "react";

interface DashboardContextValue {
  conversations: Conversation[];
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  handleNew: () => void;
  updateTitle: (id: string, title: string) => void;
  addConversation: (id: string, title: string) => void;
}

const DashboardContext = createContext<DashboardContextValue>({
  conversations: [],
  activeId: null,
  setActiveId: () => {},
  handleNew: () => {},
  updateTitle: () => {},
  addConversation: () => {},
});

export function useDashboard() {
  return useContext(DashboardContext);
}
