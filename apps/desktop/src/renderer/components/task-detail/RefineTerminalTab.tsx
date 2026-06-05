import { useEffect, useRef, useCallback, useState } from 'react';
import { CheckCircle2, RotateCcw, Play } from 'lucide-react';
import { useTerminalStore } from '../../stores/terminal-store';
import { useProjectStore } from '../../stores/project-store';
import { Button } from '../ui/button';
import { Terminal } from '../Terminal';
import { RefinePhaseBar, type PhaseInfo } from './RefinePhaseBar';

interface RefineTerminalTabProps {
  taskId: string;
  taskTitle: string;
  taskDescription: string;
  autoMode: boolean;
  isActive: boolean;
}

interface SessionInfo {
  completedPhases: string[];
  mode: string;
}

function getRefineTerminalId(taskId: string): string {
  return `refine-${taskId}`;
}

export function RefineTerminalTab({ taskId, taskTitle, taskDescription, autoMode, isActive }: RefineTerminalTabProps) {
  const terminalId = getRefineTerminalId(taskId);
  const activeProject = useProjectStore(s => s.getActiveProject());
  const projectPath = activeProject?.path;
  const terminal = useTerminalStore(s => s.terminals.find(t => t.id === terminalId));
  const orchestratorStartedRef = useRef(false);
  const [phases, setPhases] = useState<PhaseInfo[]>([]);
  const [currentPhaseIndex, setCurrentPhaseIndex] = useState(-1);
  const [existingSession, setExistingSession] = useState<SessionInfo | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI?.taskRefineGetSession(taskId).then((result) => {
      if (cancelled) return;
      if (result?.success && result.data) {
        const session = (result.data as { session: SessionInfo }).session;
        if (session?.completedPhases?.length > 0) {
          setExistingSession(session);
        } else {
          setExistingSession(null);
        }
      } else {
        setExistingSession(null);
      }
    }).catch(() => { if (!cancelled) setExistingSession(null); });
    return () => { cancelled = true; };
  }, [taskId]);

  useEffect(() => {
    if (!projectPath) return;
    const existing = useTerminalStore.getState().terminals.find(t => t.id === terminalId);
    if (!existing) {
      useTerminalStore.getState().addExternalTerminal(
        terminalId,
        `Refine: ${taskTitle}`,
        projectPath,
        projectPath,
      );
    }
  }, [terminalId, taskTitle, projectPath]);

  const startOrchestrator = useCallback(() => {
    if (orchestratorStartedRef.current) return;
    orchestratorStartedRef.current = true;
    window.electronAPI?.taskRefineTerminalStart(taskId, autoMode);
  }, [taskId, autoMode]);

  useEffect(() => {
    if (existingSession !== null || !terminal || !projectPath || orchestratorStartedRef.current) return;
    if (terminal.status !== 'running' && terminal.status !== 'idle') return;
    if (existingSession === undefined) return;

    const timer = setTimeout(startOrchestrator, 500);
    return () => clearTimeout(timer);
  }, [terminal, projectPath, existingSession, startOrchestrator]);

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onTaskRefinePhaseChange(
      (eventTaskId, _phase, phaseIndex, allPhases) => {
        if (eventTaskId !== taskId) return;
        setPhases(allPhases);
        setCurrentPhaseIndex(phaseIndex);
        setExistingSession(null);
      },
    );
    return () => { unsubscribe?.(); };
  }, [taskId]);

  const handleResume = useCallback(() => {
    setExistingSession(null);
    setTimeout(startOrchestrator, 300);
  }, [startOrchestrator]);

  const handleRestart = useCallback(() => {
    orchestratorStartedRef.current = false;
    window.electronAPI?.taskRefineResetSession(taskId).then(() => {
      setExistingSession(null);
      setTimeout(startOrchestrator, 300);
    }).catch(() => {});
  }, [taskId, startOrchestrator]);

  const handleSkip = useCallback(() => {
    window.electronAPI?.taskRefineSkipPhase(taskId);
  }, [taskId]);

  const handleClose = useCallback(() => {}, []);

  const handleActivate = useCallback(() => {
    useTerminalStore.getState().setActiveTerminal(terminalId);
  }, [terminalId]);

  if (!projectPath) return null;

  if (existingSession) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-6">
        <div className="text-center space-y-2">
          <h3 className="text-lg font-medium">Previous Refine Session Found</h3>
          <p className="text-sm text-muted-foreground">
            {existingSession.completedPhases.length} phase{existingSession.completedPhases.length !== 1 ? 's' : ''} completed
          </p>
        </div>
        <div className="flex flex-col gap-1.5 w-48">
          {existingSession.completedPhases.map((name) => (
            <div key={name} className="flex items-center gap-2 text-sm text-success">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span className="capitalize">{name}</span>
            </div>
          ))}
        </div>
        <div className="flex gap-2 mt-2">
          <Button onClick={handleResume} className="gap-1.5">
            <Play className="h-3.5 w-3.5" />
            Resume
          </Button>
          <Button variant="outline" onClick={handleRestart} className="gap-1.5">
            <RotateCcw className="h-3.5 w-3.5" />
            Start Fresh
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {phases.length > 0 && (
        <RefinePhaseBar
          phases={phases}
          currentPhaseIndex={currentPhaseIndex}
          onSkip={handleSkip}
        />
      )}
      <div className="flex-1 min-h-0">
        <Terminal
          id={terminalId}
          cwd={projectPath}
          projectPath={projectPath}
          isActive={isActive}
          onClose={handleClose}
          onActivate={handleActivate}
          terminalCount={1}
        />
      </div>
    </div>
  );
}
