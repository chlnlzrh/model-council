/**
 * Mode panel registry — maps each DeliberationMode to its result panel component.
 *
 * Council mode uses the existing Stage1/2/3 panels directly (handled by
 * deliberation-view.tsx). All other modes map to a shared panel component.
 */

import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import type { DeliberationMode } from "@/lib/council/types";
import type { ModePanelProps } from "./types";

const VotingPanel = dynamic(
  () => import("./voting-panel").then((m) => m.VotingPanel),
  { ssr: false }
) as ComponentType<ModePanelProps>;

const RolePanel = dynamic(
  () => import("./role-panel").then((m) => m.RolePanel),
  { ssr: false }
) as ComponentType<ModePanelProps>;

const RoundsPanel = dynamic(
  () => import("./rounds-panel").then((m) => m.RoundsPanel),
  { ssr: false }
) as ComponentType<ModePanelProps>;

const SequentialPanel = dynamic(
  () => import("./sequential-panel").then((m) => m.SequentialPanel),
  { ssr: false }
) as ComponentType<ModePanelProps>;

const BracketPanel = dynamic(
  () => import("./bracket-panel").then((m) => m.BracketPanel),
  { ssr: false }
) as ComponentType<ModePanelProps>;

const IdeationPanel = dynamic(
  () => import("./ideation-panel").then((m) => m.IdeationPanel),
  { ssr: false }
) as ComponentType<ModePanelProps>;

const VerificationPanel = dynamic(
  () => import("./verification-panel").then((m) => m.VerificationPanel),
  { ssr: false }
) as ComponentType<ModePanelProps>;

const WeightedPanel = dynamic(
  () => import("./weighted-panel").then((m) => m.WeightedPanel),
  { ssr: false }
) as ComponentType<ModePanelProps>;

const BlueprintPanel = dynamic(
  () => import("./blueprint-panel").then((m) => m.BlueprintPanel),
  { ssr: false }
) as ComponentType<ModePanelProps>;

const MODE_PANEL_MAP: Partial<Record<DeliberationMode, ComponentType<ModePanelProps>>> = {
  vote: VotingPanel,
  debate: VotingPanel,
  specialist_panel: RolePanel,
  jury: RolePanel,
  peer_review: RolePanel,
  delphi: RoundsPanel,
  red_team: RoundsPanel,
  chain: SequentialPanel,
  decompose: SequentialPanel,
  tournament: BracketPanel,
  brainstorm: IdeationPanel,
  fact_check: VerificationPanel,
  confidence_weighted: WeightedPanel,
  blueprint: BlueprintPanel,
};

export function getModePanel(
  mode: DeliberationMode
): ComponentType<ModePanelProps> | null {
  return MODE_PANEL_MAP[mode] ?? null;
}
