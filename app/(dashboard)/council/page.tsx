"use client";

import { DeliberationView } from "@/components/council/deliberation-view";
import { useDashboard } from "../layout";

export default function CouncilPage() {
  const {
    activeId,
    updateTitle,
    addConversation,
    selectedMode,
    setSelectedMode,
    modelConfig,
  } = useDashboard();

  const handleTitleChange = (title: string) => {
    if (activeId) updateTitle(activeId, title);
  };

  return (
    <DeliberationView
      mode={selectedMode}
      onModeChange={setSelectedMode}
      onTitleChange={handleTitleChange}
      onConversationCreated={addConversation}
      councilModels={modelConfig.councilModels}
      chairmanModel={modelConfig.chairmanModel}
      loadConversationId={activeId}
    />
  );
}
