/**
 * Data transformation utilities for ideation
 * Converts between snake_case (Python backend) and camelCase (TypeScript frontend)
 */

import type {
  Idea,
  FeatureIdea,
  CodeImprovementIdea,
  UIUXImprovementIdea,
  DocumentationGapIdea,
  SecurityHardeningIdea,
  PerformanceOptimizationIdea,
  CodeQualityIdea,
  IdeationStatus,
  IdeationConfig,
  IdeationSession
} from '../../../shared/types';
import { debugLog } from '../../../shared/utils/debug-logger';
import type { RawIdea, RawIdeationConfig } from './types';
import { isIdeationType, normalizeIdeationFocus, resolveEnabledIdeationTypes } from '../../../shared/utils/ideation-config';
import { directionIdsFromRaw } from '../roadmap/feature-persistence';

/** Saved ideation.json config → IdeationConfig (types new since it was saved count as enabled) */
export function transformConfigFromSnakeCase(raw: RawIdeationConfig | undefined): IdeationConfig {
  const savedTypes = raw?.enabled_types ?? raw?.enabledTypes;
  const enabledTypes = resolveEnabledIdeationTypes(savedTypes, raw?.known_types);
  if (Array.isArray(savedTypes) && savedTypes.some((t) => !isIdeationType(t))) {
    debugLog('[Transformers] Dropped invalid IdeationType values:', savedTypes.filter((t) => !isIdeationType(t)));
  }
  const focus = normalizeIdeationFocus(raw?.focus);
  return {
    enabledTypes,
    includeRoadmapContext: raw?.include_roadmap_context ?? raw?.includeRoadmapContext ?? true,
    includeKanbanContext: raw?.include_kanban_context ?? raw?.includeKanbanContext ?? true,
    maxIdeasPerType: raw?.max_ideas_per_type || raw?.maxIdeasPerType || 5,
    ...(focus ? { focus } : {}),
  };
}

/**
 * Transform an idea from snake_case (Python backend) to camelCase (TypeScript frontend)
 */
export function transformIdeaFromSnakeCase(idea: RawIdea): Idea {
  return withFunnelLinks(transformIdeaFields(idea), idea);
}

/** Task / roadmap / direction links shared by every idea type (only set when present) */
function withFunnelLinks(result: Idea, idea: RawIdea): Idea {
  const directionIds = directionIdsFromRaw(idea);
  if (directionIds) result.directionIds = directionIds;
  if (typeof idea.linked_task_id === 'string' && idea.linked_task_id) result.taskId = idea.linked_task_id;
  if (typeof idea.roadmap_feature_id === 'string' && idea.roadmap_feature_id) {
    result.roadmapFeatureId = idea.roadmap_feature_id;
  }
  return result;
}

/** low | medium | high, anything else → medium */
function toLevel(value: unknown): 'low' | 'medium' | 'high' {
  const level = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return level === 'low' || level === 'high' ? level : 'medium';
}

function transformIdeaFields(idea: RawIdea): Idea {
  const status = (idea.status || 'draft') as IdeationStatus;
  const createdAt = idea.created_at ? new Date(idea.created_at) : new Date();

  if (idea.type === 'features') {
    return {
      id: idea.id,
      type: 'features',
      title: idea.title,
      description: idea.description,
      rationale: idea.rationale,
      status,
      createdAt,
      userValue: idea.user_value || idea.userValue || '',
      targetUsers: idea.target_users || idea.targetUsers || '',
      complexity: toLevel(idea.complexity),
      impact: toLevel(idea.impact)
    } as FeatureIdea;
  } else if (idea.type === 'code_improvements') {
    return {
      id: idea.id,
      type: 'code_improvements',
      title: idea.title,
      description: idea.description,
      rationale: idea.rationale,
      status,
      createdAt,
      buildsUpon: idea.builds_upon || idea.buildsUpon || [],
      estimatedEffort: idea.estimated_effort || idea.estimatedEffort || 'small',
      affectedFiles: idea.affected_files || idea.affectedFiles || [],
      existingPatterns: idea.existing_patterns || idea.existingPatterns || [],
      implementationApproach: idea.implementation_approach || idea.implementationApproach || ''
    } as CodeImprovementIdea;
  } else if (idea.type === 'ui_ux_improvements') {
    return {
      id: idea.id,
      type: 'ui_ux_improvements',
      title: idea.title,
      description: idea.description,
      rationale: idea.rationale,
      status,
      createdAt,
      category: idea.category || 'usability',
      affectedComponents: idea.affected_components || idea.affectedComponents || [],
      screenshots: idea.screenshots || [],
      currentState: idea.current_state || idea.currentState || '',
      proposedChange: idea.proposed_change || idea.proposedChange || '',
      userBenefit: idea.user_benefit || idea.userBenefit || ''
    } as UIUXImprovementIdea;
  } else if (idea.type === 'documentation_gaps') {
    return {
      id: idea.id,
      type: 'documentation_gaps',
      title: idea.title,
      description: idea.description,
      rationale: idea.rationale,
      status,
      createdAt,
      category: idea.category || 'readme',
      targetAudience: idea.target_audience || idea.targetAudience || 'developers',
      affectedAreas: idea.affected_areas || idea.affectedAreas || [],
      currentDocumentation: idea.current_documentation || idea.currentDocumentation || '',
      proposedContent: idea.proposed_content || idea.proposedContent || '',
      priority: idea.priority || 'medium',
      estimatedEffort: idea.estimated_effort || idea.estimatedEffort || 'small'
    } as DocumentationGapIdea;
  } else if (idea.type === 'security_hardening') {
    return {
      id: idea.id,
      type: 'security_hardening',
      title: idea.title,
      description: idea.description,
      rationale: idea.rationale,
      status,
      createdAt,
      category: idea.category || 'configuration',
      severity: idea.severity || 'medium',
      affectedFiles: idea.affected_files || idea.affectedFiles || [],
      vulnerability: idea.vulnerability || '',
      currentRisk: idea.current_risk || idea.currentRisk || '',
      remediation: idea.remediation || '',
      references: idea.references || [],
      compliance: idea.compliance || []
    } as SecurityHardeningIdea;
  } else if (idea.type === 'performance_optimizations') {
    return {
      id: idea.id,
      type: 'performance_optimizations',
      title: idea.title,
      description: idea.description,
      rationale: idea.rationale,
      status,
      createdAt,
      category: idea.category || 'runtime',
      impact: idea.impact || 'medium',
      affectedAreas: idea.affected_areas || idea.affectedAreas || [],
      currentMetric: idea.current_metric || idea.currentMetric || '',
      expectedImprovement: idea.expected_improvement || idea.expectedImprovement || '',
      implementation: idea.implementation || '',
      tradeoffs: idea.tradeoffs || '',
      estimatedEffort: idea.estimated_effort || idea.estimatedEffort || 'medium'
    } as PerformanceOptimizationIdea;
  } else if (idea.type === 'code_quality') {
    return {
      id: idea.id,
      type: 'code_quality',
      title: idea.title,
      description: idea.description,
      rationale: idea.rationale,
      status,
      createdAt,
      category: idea.category || 'code_smells',
      severity: idea.severity || 'minor',
      affectedFiles: idea.affected_files || idea.affectedFiles || [],
      currentState: idea.current_state || idea.currentState || '',
      proposedChange: idea.proposed_change || idea.proposedChange || '',
      codeExample: idea.code_example || idea.codeExample || '',
      bestPractice: idea.best_practice || idea.bestPractice || '',
      metrics: idea.metrics || {},
      estimatedEffort: idea.estimated_effort || idea.estimatedEffort || 'medium',
      breakingChange: idea.breaking_change ?? idea.breakingChange ?? false,
      prerequisites: idea.prerequisites || []
    } as CodeQualityIdea;
  }

  // Fallback to base idea (shouldn't happen with proper data)
  return {
    id: idea.id,
    type: 'code_improvements',
    title: idea.title,
    description: idea.description,
    rationale: idea.rationale,
    status,
    createdAt,
    buildsUpon: [],
    estimatedEffort: 'small',
    affectedFiles: [],
    existingPatterns: [],
    implementationApproach: ''
  } as CodeImprovementIdea;
}

interface RawIdeationSession {
  id?: string;
  project_id?: string;
  config?: RawIdeationConfig;
  ideas?: RawIdea[];
  project_context?: {
    existing_features?: string[];
    tech_stack?: string[];
    target_audience?: string;
    planned_features?: string[];
  };
  projectContext?: {
    existingFeatures?: string[];
    techStack?: string[];
    targetAudience?: string;
    plannedFeatures?: string[];
  };
  generated_at?: string;
  updated_at?: string;
}

export function transformSessionFromSnakeCase(
  rawSession: RawIdeationSession,
  projectId: string
): IdeationSession {
  return {
    id: rawSession.id || `ideation-${Date.now()}`,
    projectId,
    config: transformConfigFromSnakeCase(rawSession.config),
    ideas: (rawSession.ideas || []).map(idea => transformIdeaFromSnakeCase(idea)),
    projectContext: {
      existingFeatures: rawSession.project_context?.existing_features || rawSession.projectContext?.existingFeatures || [],
      techStack: rawSession.project_context?.tech_stack || rawSession.projectContext?.techStack || [],
      targetAudience: rawSession.project_context?.target_audience || rawSession.projectContext?.targetAudience,
      plannedFeatures: rawSession.project_context?.planned_features || rawSession.projectContext?.plannedFeatures || []
    },
    generatedAt: rawSession.generated_at ? new Date(rawSession.generated_at) : new Date(),
    updatedAt: rawSession.updated_at ? new Date(rawSession.updated_at) : new Date()
  };
}
