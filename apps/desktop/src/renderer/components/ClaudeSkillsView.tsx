import { useState, useEffect, useRef } from 'react';
import { Check, ChevronDown, ChevronRight, FolderOpen, Globe, Pencil, RefreshCw, Wand, X } from 'lucide-react';
import { ScrollArea } from './ui/scroll-area';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { useProjectStore } from '../stores/project-store';
import type { ClaudeSkill } from '../../shared/types';

function SkillCard({
  skill,
  onSaved
}: {
  skill: ClaudeSkill;
  onSaved: (updatedContent: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(skill.content);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft(skill.content);
    setIsEditing(true);
    setSaveError(null);
    if (!expanded) setExpanded(true);
  };

  const cancelEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(false);
    setDraft(skill.content);
    setSaveError(null);
  };

  const save = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsSaving(true);
    setSaveError(null);
    try {
      const result = await window.electronAPI.saveClaudeSkill(skill.path, draft);
      if (result.success) {
        setIsEditing(false);
        onSaved(draft);
      } else {
        setSaveError(result.error ?? 'Failed to save');
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      save(e as unknown as React.MouseEvent);
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setDraft(skill.content);
      setSaveError(null);
    }
  };

  // Auto-focus textarea when editing starts
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(0, 0);
    }
  }, [isEditing]);

  return (
    <div className="rounded-lg border border-border bg-card">
      {/* Header row */}
      <div className="flex items-center">
        <button
          type="button"
          className="flex flex-1 items-start gap-3 p-3 text-left hover:bg-accent/50 transition-colors rounded-lg"
          onClick={() => !isEditing && setExpanded((v) => !v)}
        >
          <div className="mt-0.5 flex-shrink-0 text-muted-foreground">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-sm text-foreground break-words min-w-0">{skill.name}</span>
              <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono break-all">
                {skill.filename}
              </span>
            </div>
            {skill.description && (
              <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{skill.description}</p>
            )}
          </div>
        </button>

        {/* Edit / Save / Cancel controls */}
        <div className="flex items-center gap-1 pr-2">
          {isEditing ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={save}
                disabled={isSaving}
                className="h-7 w-7 p-0 max-md:h-10 max-md:w-10 text-green-500 hover:text-green-400 hover:bg-green-500/10"
                title="Save (⌘Enter)"
              >
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={cancelEdit}
                disabled={isSaving}
                className="h-7 w-7 p-0 max-md:h-10 max-md:w-10 text-muted-foreground hover:text-foreground"
                title="Cancel (Esc)"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={startEdit}
              className="h-7 w-7 p-0 max-md:h-10 max-md:w-10 text-muted-foreground hover:text-foreground"
              title="Edit"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-3 pb-3">
          {saveError && (
            <p className="mb-2 text-xs text-destructive">{saveError}</p>
          )}
          {isEditing ? (
            <>
              <Textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                className="mt-1 font-mono text-xs min-h-[200px] resize-y"
                spellCheck={false}
              />
              <p className="mt-1.5 text-xs text-muted-foreground">⌘Enter to save · Esc to cancel</p>
            </>
          ) : (
            <pre className="mt-1 rounded bg-muted p-3 text-xs text-foreground overflow-auto whitespace-pre-wrap break-words max-h-64">
              {skill.content}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function SkillSection({
  title,
  icon,
  subtitle,
  skills,
  emptyMessage,
  onSkillSaved
}: {
  title: string;
  icon: React.ReactNode;
  subtitle: string;
  skills: ClaudeSkill[];
  emptyMessage: string;
  onSkillSaved: (path: string, content: string) => void;
}) {
  return (
    <div className="mb-6">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="text-xs text-muted-foreground break-all">{subtitle}</p>
        </div>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
          {skills.length}
        </span>
      </div>
      {skills.length === 0 ? (
        <p className="text-xs text-muted-foreground italic px-1 break-words">{emptyMessage}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {skills.map((skill) => (
            <SkillCard
              key={skill.path}
              skill={skill}
              onSaved={(content) => onSkillSaved(skill.path, content)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function ClaudeSkillsView() {
  const [globalSkills, setGlobalSkills] = useState<ClaudeSkill[]>([]);
  const [projectSkills, setProjectSkills] = useState<ClaudeSkill[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeProject = useProjectStore((state) =>
    state.projects.find((p) => p.id === (state.activeProjectId ?? state.selectedProjectId))
  );

  const loadSkills = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI.listClaudeSkills(activeProject?.path);
      if (result.success && result.data) {
        setGlobalSkills(result.data.global);
        setProjectSkills(result.data.project);
      } else {
        setError(result.error ?? 'Failed to load skills');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load skills');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSkillSaved = (
    list: 'global' | 'project',
    skillPath: string,
    newContent: string
  ) => {
    const updater = (skills: ClaudeSkill[]) =>
      skills.map((s) => (s.path === skillPath ? { ...s, content: newContent } : s));
    if (list === 'global') setGlobalSkills(updater);
    else setProjectSkills(updater);
  };

  useEffect(() => {
    loadSkills();
  }, [activeProject?.path]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Wand className="h-4 w-4 text-muted-foreground" />
          <h1 className="text-sm font-semibold">Skills</h1>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={loadSkills}
          disabled={isLoading}
          className="h-7 w-7 p-0 max-md:h-10 max-md:w-10"
          title="Refresh"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      <ScrollArea className="flex-1" viewportClassName="max-md:[&>div]:block!">
        <div className="p-4">
          {error && (
            <p className="mb-4 text-xs text-destructive">{error}</p>
          )}

          <SkillSection
            title="Global Skills"
            icon={<Globe className="h-4 w-4" />}
            subtitle="~/.claude/skills"
            skills={globalSkills}
            emptyMessage="No skills found in ~/.claude/skills"
            onSkillSaved={(p, c) => handleSkillSaved('global', p, c)}
          />

          <SkillSection
            title="Project Skills"
            icon={<FolderOpen className="h-4 w-4" />}
            subtitle={activeProject ? `${activeProject.path}/.claude/skills` : 'No project selected'}
            skills={projectSkills}
            emptyMessage={
              activeProject
                ? `No skills found in ${activeProject.name}/.claude/skills`
                : 'Select a project to see its skills'
            }
            onSkillSaved={(p, c) => handleSkillSaved('project', p, c)}
          />
        </div>
      </ScrollArea>
    </div>
  );
}
