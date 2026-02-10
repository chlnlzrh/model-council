"use client";

import { useState, useCallback, useEffect, createContext, useContext } from "react";
import { useSession } from "next-auth/react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Sidebar } from "@/components/layout/sidebar";
import { useModelConfig } from "@/hooks/use-model-config";
import type { DeliberationMode } from "@/lib/council/types";

interface Conversation {
  id: string;
  title: string;
  mode: string;
}

interface DashboardContextValue {
  conversations: Conversation[];
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  handleNew: () => void;
  updateTitle: (id: string, title: string) => void;
  addConversation: (id: string, title: string, mode?: string) => void;
  selectedMode: DeliberationMode;
  setSelectedMode: (mode: DeliberationMode) => void;
  modelConfig: {
    councilModels: string[];
    chairmanModel: string;
  };
  updateModelConfig: (update: Partial<{ councilModels: string[]; chairmanModel: string }>) => void;
}

const DashboardContext = createContext<DashboardContextValue>({
  conversations: [],
  activeId: null,
  setActiveId: () => {},
  handleNew: () => {},
  updateTitle: () => {},
  addConversation: () => {},
  selectedMode: "council",
  setSelectedMode: () => {},
  modelConfig: { councilModels: [], chairmanModel: "" },
  updateModelConfig: () => {},
});

export function useDashboard() {
  return useContext(DashboardContext);
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
  const [selectedMode, setSelectedMode] = useState<DeliberationMode>("council");
  const { config: modelConfig, updateConfig: updateModelConfig } = useModelConfig();

  // Load conversations from DB
  useEffect(() => {
    if (!session?.user) return;
    fetch("/api/conversations")
      .then((res) => (res.ok ? res.json() : []))
      .then((data: Array<{ id: string; title: string; mode?: string }>) =>
        setConversations(data.map((c) => ({ id: c.id, title: c.title, mode: c.mode ?? "council" })))
      )
      .catch(() => {});
  }, [session?.user]);

  const handleNew = useCallback(() => {
    setActiveId(null);
    setSelectedMode("council");
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

  const addConversation = useCallback((id: string, title: string, mode?: string) => {
    setConversations((prev) => {
      if (prev.some((c) => c.id === id)) {
        return prev.map((c) => (c.id === id ? { ...c, title, mode: mode ?? c.mode } : c));
      }
      return [{ id, title, mode: mode ?? selectedMode }, ...prev];
    });
    setActiveId(id);
  }, [selectedMode]);

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
            selectedMode,
            setSelectedMode,
            modelConfig,
            updateModelConfig,
          }}
        >
          {children}
        </DashboardContext.Provider>
      </div>
    </div>
  );
}
