"use client";

import { CouncilView } from "@/components/council/council-view";
import { useDashboard } from "../layout";

export default function CouncilPage() {
  const { activeId, updateTitle, addConversation, modelConfig } = useDashboard();

  const handleTitleChange = (title: string) => {
    if (activeId) updateTitle(activeId, title);
  };

  return (
    <CouncilView
      onTitleChange={handleTitleChange}
      onConversationCreated={addConversation}
      councilModels={modelConfig.councilModels}
      chairmanModel={modelConfig.chairmanModel}
    />
  );
}
