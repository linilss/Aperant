import type { RoadmapFeature, RoadmapPhase, Roadmap, CompetitorPainPoint, CompetitorAnalysis } from '../../../shared/types';

export interface RoadmapProps {
  projectId: string;
  onGoToTask?: (taskId: string) => void;
  /** Back to Plan → Competitors (from the "Guided by" chip) */
  onGoToCompetitors?: () => void;
  /** Tab to show, e.g. 'moscow' when navigating from "View in MoSCoW" */
  initialTab?: string;
  /** Changes on every navigation request so the same tab can be re-requested */
  tabRequestId?: number;
  /** Ideation's generation settings (idea types, focus) */
  onOpenIdeaSettings?: () => void;
}

export interface PhaseCardProps {
  phase: RoadmapPhase;
  features: RoadmapFeature[];
  isFirst: boolean;
  onFeatureSelect: (feature: RoadmapFeature) => void;
  onConvertToSpec: (feature: RoadmapFeature) => void;
  onGoToTask: (specId: string) => void;
  onArchive?: (featureId: string) => void;
}

export interface FeatureCardProps {
  feature: RoadmapFeature;
  onClick: () => void;
  onConvertToSpec: (feature: RoadmapFeature) => void;
  onGoToTask: (specId: string) => void;
  hasCompetitorInsight?: boolean;
  onArchive?: (featureId: string) => void;
}

export interface FeatureDetailPanelProps {
  feature: RoadmapFeature;
  onClose: () => void;
  onConvertToSpec: (feature: RoadmapFeature) => void;
  onGoToTask: (specId: string) => void;
  onRefine?: (feature: RoadmapFeature) => void;
  onDelete?: (featureId: string) => void;
  onArchive?: (featureId: string) => void;
  competitorInsights?: CompetitorPainPoint[];
}

export interface RoadmapHeaderProps {
  roadmap: Roadmap;
  competitorAnalysis: CompetitorAnalysis | null;
  onAddFeature: () => void;
  onRefresh: () => void;
  onViewCompetitorAnalysis?: () => void;
  onRefineFeature: () => void;
  /** Remove every feature that isn't done (asks first) */
  onClearOpen: () => void;
}

export interface RoadmapEmptyStateProps {
  onGenerate: () => void;
}

export interface RoadmapTabsProps {
  roadmap: Roadmap;
  projectId: string;
  onGoToCompetitors?: () => void;
  activeTab: string;
  onTabChange: (tab: string) => void;
  onFeatureSelect: (feature: RoadmapFeature) => void;
  onConvertToSpec: (feature: RoadmapFeature) => void;
  onGoToTask: (specId: string) => void;
  onSave?: () => void;
  onArchive?: (featureId: string) => void;
  /** Ideation's generation settings (idea types, focus) */
  onOpenIdeaSettings?: () => void;
}
