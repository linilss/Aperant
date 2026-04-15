import { ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type { IPCResult, FileNode, ClaudeAgentsResult, ClaudeSkillsResult } from '../../shared/types';

export interface FileAPI {
  // File Explorer Operations
  listDirectory: (dirPath: string) => Promise<IPCResult<FileNode[]>>;
  readFile: (filePath: string) => Promise<IPCResult<string>>;
  listClaudeAgents: (projectPath?: string) => Promise<IPCResult<ClaudeAgentsResult>>;
  saveClaudeAgent: (filePath: string, content: string) => Promise<IPCResult<void>>;
  listClaudeSkills: (projectPath?: string) => Promise<IPCResult<ClaudeSkillsResult>>;
  saveClaudeSkill: (filePath: string, content: string) => Promise<IPCResult<void>>;
}

export const createFileAPI = (): FileAPI => ({
  // File Explorer Operations
  listDirectory: (dirPath: string): Promise<IPCResult<FileNode[]>> =>
    ipcRenderer.invoke(IPC_CHANNELS.FILE_EXPLORER_LIST, dirPath),
  readFile: (filePath: string): Promise<IPCResult<string>> =>
    ipcRenderer.invoke(IPC_CHANNELS.FILE_EXPLORER_READ, filePath),
  listClaudeAgents: (projectPath?: string): Promise<IPCResult<ClaudeAgentsResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.CLAUDE_AGENTS_LIST, projectPath),
  saveClaudeAgent: (filePath: string, content: string): Promise<IPCResult<void>> =>
    ipcRenderer.invoke(IPC_CHANNELS.CLAUDE_AGENT_SAVE, filePath, content),
  listClaudeSkills: (projectPath?: string): Promise<IPCResult<ClaudeSkillsResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.CLAUDE_SKILLS_LIST, projectPath),
  saveClaudeSkill: (filePath: string, content: string): Promise<IPCResult<void>> =>
    ipcRenderer.invoke(IPC_CHANNELS.CLAUDE_SKILL_SAVE, filePath, content),
});
