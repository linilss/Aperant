/**
 * Tests for Client Factory
 *
 * Validates createSimpleClient() and createAgentClient() — model resolution,
 * credential wiring, tool registry binding, queue-based auth, and cleanup.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock auth resolver — inline to avoid hoisting issues
vi.mock('../../auth/resolver', () => ({
  resolveAuth: vi.fn().mockResolvedValue({ apiKey: 'sk-default', source: 'environment' }),
  resolveAuthFromQueue: vi.fn().mockResolvedValue(null),
  buildDefaultQueueConfig: vi.fn().mockReturnValue(undefined),
  resolveProfileOAuthAuth: vi.fn().mockResolvedValue({ apiKey: 'sk-ant-oat01-pinned', source: 'profile-oauth' }),
  queueHasProfileAccount: (queue: Array<{ claudeProfileId?: string }>, id: string) =>
    queue.some((a) => a.claudeProfileId === id),
  applyProfilePinToQueue: (queue: Array<{ claudeProfileId?: string }>, id: string, strict: boolean) =>
    strict ? queue.filter((a) => a.claudeProfileId === id) : queue,
}));

// Per-project Claude account: projects under /chippio/ are pinned (strict)
vi.mock('../../../claude-profile/project-profile', () => ({
  getProjectProfileBinding: (ref: { projectPath?: string }) =>
    ref.projectPath?.includes('/chippio/')
      ? { profileId: 'p-chippio', profileName: 'Chippio', strict: true, configDir: '/cfg/chippio', env: {} }
      : null,
}));

// Mock provider factory — inline
vi.mock('../../providers/factory', () => ({
  createProvider: vi.fn().mockReturnValue({ type: 'language-model', modelId: 'mock-model-id' }),
  detectProviderFromModel: vi.fn().mockReturnValue('anthropic'),
}));

// Mock phase config — inline
vi.mock('../../config/phase-config', () => ({
  resolveModelId: vi.fn().mockReturnValue('claude-haiku-4-5'),
}));

// Mock agent configs — inline
vi.mock('../../config/agent-configs', () => ({
  getDefaultThinkingLevel: vi.fn().mockReturnValue('medium'),
  getRequiredMcpServers: vi.fn().mockReturnValue([]),
}));

// Mock MCP client module — inline
vi.mock('../../mcp/client', () => ({
  createMcpClientsForAgent: vi.fn().mockResolvedValue([]),
  closeAllMcpClients: vi.fn().mockResolvedValue(undefined),
  mergeMcpTools: vi.fn().mockReturnValue({}),
}));

// Mock tool registry — inline
vi.mock('../../tools/build-registry', () => ({
  buildToolRegistry: vi.fn().mockReturnValue({
    getToolsForAgent: vi.fn().mockReturnValue({ Read: {}, Write: {} }),
  }),
}));

// Mock config/types resolveReasoningParams — inline
vi.mock('../../config/types', () => ({
  resolveReasoningParams: vi.fn().mockReturnValue({}),
}));

import { resolveAuth, resolveAuthFromQueue, buildDefaultQueueConfig, resolveProfileOAuthAuth } from '../../auth/resolver';
import { createProvider, detectProviderFromModel } from '../../providers/factory';
import { resolveModelId } from '../../config/phase-config';
import { getDefaultThinkingLevel, getRequiredMcpServers } from '../../config/agent-configs';
import { createMcpClientsForAgent, closeAllMcpClients, mergeMcpTools } from '../../mcp/client';
import { buildToolRegistry } from '../../tools/build-registry';
import { createSimpleClient, createAgentClient, shouldRouteViaClaudeCli } from '../factory';
import { isClaudeCliModel } from '../../cli/claude-cli-model';
import type { LanguageModel, Tool } from 'ai';
import type { ToolContext } from '../../tools/types';
import type { AgentClientConfig } from '../types';
import type { ProviderAccount } from '../../../../shared/types/provider-account';
import type { McpClientResult } from '../../mcp/types';
import type { ToolRegistry } from '../../tools/registry';

const mockResolveAuth = vi.mocked(resolveAuth);
const mockResolveAuthFromQueue = vi.mocked(resolveAuthFromQueue);
const mockBuildDefaultQueueConfig = vi.mocked(buildDefaultQueueConfig);
const mockCreateProvider = vi.mocked(createProvider);
const mockDetectProviderFromModel = vi.mocked(detectProviderFromModel);
const mockResolveModelId = vi.mocked(resolveModelId);
const mockGetDefaultThinkingLevel = vi.mocked(getDefaultThinkingLevel);
const mockGetRequiredMcpServers = vi.mocked(getRequiredMcpServers);
const mockCreateMcpClientsForAgent = vi.mocked(createMcpClientsForAgent);
const mockCloseAllMcpClients = vi.mocked(closeAllMcpClients);
const mockMergeMcpTools = vi.mocked(mergeMcpTools);
const mockBuildToolRegistry = vi.mocked(buildToolRegistry);

const FAKE_MODEL = { type: 'language-model', modelId: 'mock-model-id' };

const baseToolContext = {
  cwd: '/project',
  projectDir: '/project',
  specDir: '/project/.malvy/specs/001',
  securityProfile: 'standard' as const,
} as unknown as ToolContext;

beforeEach(() => {
  vi.clearAllMocks();

  // Re-establish defaults after clearAllMocks
  mockResolveAuth.mockResolvedValue({ apiKey: 'sk-default', source: 'environment' });
  mockResolveAuthFromQueue.mockResolvedValue(null);
  mockBuildDefaultQueueConfig.mockReturnValue(undefined);
  mockCreateProvider.mockReturnValue(FAKE_MODEL as unknown as LanguageModel);
  mockDetectProviderFromModel.mockReturnValue('anthropic');
  mockResolveModelId.mockReturnValue('claude-haiku-4-5');
  mockGetDefaultThinkingLevel.mockReturnValue('medium');
  mockGetRequiredMcpServers.mockReturnValue([]);
  mockCreateMcpClientsForAgent.mockResolvedValue([]);
  mockCloseAllMcpClients.mockResolvedValue(undefined);
  mockMergeMcpTools.mockReturnValue({});

  // ToolRegistry mock: getToolsForAgent returns a basic tools map
  const mockRegistry = { getToolsForAgent: vi.fn().mockReturnValue({ Read: {}, Write: {} }) };
  mockBuildToolRegistry.mockReturnValue(mockRegistry as unknown as ToolRegistry);
});

// =============================================================================
// createSimpleClient
// =============================================================================

describe('createSimpleClient', () => {
  it('returns model, resolvedModelId, tools, systemPrompt, maxSteps, and thinkingLevel', async () => {
    const result = await createSimpleClient({ systemPrompt: 'You are helpful.' });

    expect(result.model).toBe(FAKE_MODEL);
    expect(result.resolvedModelId).toBeDefined();
    expect(result.tools).toBeDefined();
    expect(result.systemPrompt).toBe('You are helpful.');
    expect(result.maxSteps).toBe(1);
    expect(result.thinkingLevel).toBe('low');
  });

  it('defaults modelShorthand to haiku when not specified', async () => {
    await createSimpleClient({ systemPrompt: 'Test' });
    expect(mockResolveModelId).toHaveBeenCalledWith('haiku');
  });

  it('uses the specified modelShorthand', async () => {
    await createSimpleClient({ systemPrompt: 'Test', modelShorthand: 'sonnet' });
    expect(mockResolveModelId).toHaveBeenCalledWith('sonnet');
  });

  it('uses the specified thinkingLevel', async () => {
    const result = await createSimpleClient({ systemPrompt: 'Test', thinkingLevel: 'high' });
    expect(result.thinkingLevel).toBe('high');
  });

  it('uses specified maxSteps', async () => {
    const result = await createSimpleClient({ systemPrompt: 'Test', maxSteps: 5 });
    expect(result.maxSteps).toBe(5);
  });

  it('wires resolved auth credentials into createProvider', async () => {
    mockResolveAuth.mockResolvedValueOnce({
      apiKey: 'sk-resolved',
      source: 'environment',
      baseURL: 'https://custom.api.com',
    });

    await createSimpleClient({ systemPrompt: 'Test' });

    expect(mockCreateProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          apiKey: 'sk-resolved',
          baseURL: 'https://custom.api.com',
        }),
      }),
    );
  });

  it('passes tools option through to result', async () => {
    const customTools = { myTool: {} as unknown as Tool };
    const result = await createSimpleClient({ systemPrompt: 'Test', tools: customTools });
    expect(result.tools).toBe(customTools);
  });

  it('uses queue-based resolution when queueConfig is provided', async () => {
    const queueAuth = {
      apiKey: 'sk-queue',
      source: 'profile-api-key' as const,
      accountId: 'acc-1',
      resolvedProvider: 'anthropic' as const,
      resolvedModelId: 'claude-opus-4-6',
      reasoningConfig: { type: 'none' as const },
    };
    mockResolveAuthFromQueue.mockResolvedValueOnce(queueAuth);

    const queueConfig = {
      queue: [{ id: 'acc-1' } as unknown as ProviderAccount],
      requestedModel: 'claude-opus-4-6',
    };

    const result = await createSimpleClient({ systemPrompt: 'Test', queueConfig });

    expect(mockResolveAuthFromQueue).toHaveBeenCalled();
    expect(result.queueAuth).toBe(queueAuth);
    expect(result.resolvedModelId).toBe('claude-opus-4-6');
  });

  it('throws when queueConfig is provided but no account is available', async () => {
    mockResolveAuthFromQueue.mockResolvedValueOnce(null);

    const queueConfig = { queue: [], requestedModel: 'sonnet' };

    await expect(
      createSimpleClient({ systemPrompt: 'Test', queueConfig }),
    ).rejects.toThrow('No available account in priority queue');
  });
});

// =============================================================================
// createSimpleClient — Claude subscription routing via the claude CLI
// =============================================================================

describe('createSimpleClient — claude CLI routing', () => {
  const DIRECT_V3_MODEL = {
    specificationVersion: 'v3',
    provider: 'anthropic.messages',
    modelId: 'claude-haiku-4-5',
    supportedUrls: {},
    doGenerate: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'direct' }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    }),
    doStream: vi.fn(),
  };

  it('returns the CLI-backed model for a Claude subscription OAuth token', async () => {
    mockResolveAuth.mockResolvedValueOnce({ apiKey: 'sk-ant-oat01-abc', source: 'profile-oauth' });

    const result = await createSimpleClient({ systemPrompt: 'Test', cwd: '/project' });

    expect(isClaudeCliModel(result.model)).toBe(true);
    expect(typeof result.model === 'object' && result.model.modelId).toBe('claude-haiku-4-5');
    expect(result.resolvedModelId).toBe('claude-haiku-4-5');
  });

  it('returns the CLI-backed model for a queue-resolved Anthropic OAuth account', async () => {
    mockResolveAuthFromQueue.mockResolvedValueOnce({
      apiKey: 'sk-ant-oat01-queue',
      source: 'profile-oauth',
      accountId: 'acc-1',
      resolvedProvider: 'anthropic',
      resolvedModelId: 'claude-sonnet-5',
      reasoningConfig: { type: 'none' },
    });

    const result = await createSimpleClient({
      systemPrompt: 'Test',
      queueConfig: { queue: [{ id: 'acc-1' } as unknown as ProviderAccount], requestedModel: 'sonnet' },
    });

    expect(isClaudeCliModel(result.model)).toBe(true);
  });

  it('keeps the direct provider model for an Anthropic API key', async () => {
    mockResolveAuth.mockResolvedValueOnce({ apiKey: 'sk-ant-api03-key', source: 'profile-api-key' });

    const result = await createSimpleClient({ systemPrompt: 'Test' });

    expect(result.model).toBe(FAKE_MODEL);
  });

  it('delegates calls with custom (non-CLI) tools to the direct model', async () => {
    mockResolveAuth.mockResolvedValueOnce({ apiKey: 'sk-ant-oat01-abc', source: 'profile-oauth' });
    mockCreateProvider.mockReturnValueOnce(DIRECT_V3_MODEL as unknown as LanguageModel);

    const result = await createSimpleClient({ systemPrompt: 'Test' });
    const model = result.model as unknown as typeof DIRECT_V3_MODEL;
    const generated = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
      tools: [{ type: 'function', name: 'update_subtask_status', inputSchema: {} }],
    });

    expect(generated.content).toEqual([{ type: 'text', text: 'direct' }]);
    expect(DIRECT_V3_MODEL.doGenerate).toHaveBeenCalled();
  });
});

describe('createSimpleClient — per-project Claude account', () => {
  const queue = [
    { id: 'personal', provider: 'anthropic', claudeProfileId: 'p-personal' },
    { id: 'chippio', provider: 'anthropic', claudeProfileId: 'p-chippio' },
  ] as unknown as ProviderAccount[];

  it("resolves a pinned project's call from the pinned account only", async () => {
    mockBuildDefaultQueueConfig.mockReturnValueOnce({ queue, requestedModel: 'claude-haiku-4-5' });
    mockResolveAuthFromQueue.mockResolvedValueOnce({
      apiKey: 'sk-ant-oat01-chippio', source: 'profile-oauth', accountId: 'chippio',
      resolvedProvider: 'anthropic', resolvedModelId: 'claude-haiku-4-5', reasoningConfig: { type: 'none' },
    });

    const result = await createSimpleClient({ systemPrompt: 'Test', projectPath: '/Users/me/chippio/app' });

    const [, passedQueue, options] = mockResolveAuthFromQueue.mock.calls[0];
    expect(passedQueue.map((a) => a.id)).toEqual(['chippio']);
    expect(options?.profileConfigDirs).toEqual({ 'p-chippio': '/cfg/chippio' });
    expect(isClaudeCliModel(result.model)).toBe(true);
  });

  it("uses the pinned profile's own credentials when no queue account is linked to it", async () => {
    mockBuildDefaultQueueConfig.mockReturnValueOnce({ queue: [queue[0]], requestedModel: 'claude-haiku-4-5' });

    await createSimpleClient({ systemPrompt: 'Test', cwd: '/Users/me/chippio/app' });

    expect(mockResolveAuthFromQueue).not.toHaveBeenCalled();
    expect(vi.mocked(resolveProfileOAuthAuth)).toHaveBeenCalledWith('/cfg/chippio');
  });

  it('leaves unpinned projects on the normal queue', async () => {
    mockBuildDefaultQueueConfig.mockReturnValueOnce({ queue, requestedModel: 'claude-haiku-4-5' });
    mockResolveAuthFromQueue.mockResolvedValueOnce(null);

    await expect(createSimpleClient({ systemPrompt: 'Test', projectPath: '/Users/me/dev/malve' })).rejects.toThrow();
    expect(mockResolveAuthFromQueue.mock.calls[0][1]).toHaveLength(2);
  });
});

describe('shouldRouteViaClaudeCli', () => {
  it('routes only Anthropic subscription credentials', () => {
    expect(shouldRouteViaClaudeCli('anthropic', { apiKey: 'sk-ant-oat01-x', source: 'environment' })).toBe(true);
    expect(shouldRouteViaClaudeCli('anthropic', { apiKey: 'tok', source: 'profile-oauth' })).toBe(true);
    expect(shouldRouteViaClaudeCli('anthropic', { apiKey: 'sk-ant-api03-x', source: 'environment' })).toBe(false);
    expect(shouldRouteViaClaudeCli('openai', { apiKey: 'sk-ant-oat01-x', source: 'profile-oauth' })).toBe(false);
    expect(shouldRouteViaClaudeCli('anthropic', null)).toBe(false);
  });
});

// =============================================================================
// createAgentClient
// =============================================================================

describe('createAgentClient', () => {
  const baseConfig = {
    agentType: 'coder' as const,
    systemPrompt: 'You are a coder.',
    toolContext: baseToolContext,
    phase: 'coding' as const,
  };

  it('returns model, tools, mcpClients, systemPrompt, maxSteps, thinkingLevel, and cleanup', async () => {
    const result = await createAgentClient(baseConfig);

    expect(result.model).toBe(FAKE_MODEL);
    expect(result.tools).toBeDefined();
    expect(result.mcpClients).toEqual([]);
    expect(result.systemPrompt).toBe('You are a coder.');
    expect(result.maxSteps).toBe(200);
    expect(result.thinkingLevel).toBeDefined();
    expect(typeof result.cleanup).toBe('function');
  });

  it('uses agent-config default thinking level', async () => {
    mockGetDefaultThinkingLevel.mockReturnValueOnce('high');

    const result = await createAgentClient(baseConfig);

    expect(result.thinkingLevel).toBe('high');
    expect(mockGetDefaultThinkingLevel).toHaveBeenCalledWith('coder');
  });

  it('overrides thinking level when thinkingLevel is specified', async () => {
    const result = await createAgentClient({ ...baseConfig, thinkingLevel: 'low' });
    expect(result.thinkingLevel).toBe('low');
  });

  it('uses specified maxSteps', async () => {
    const result = await createAgentClient({ ...baseConfig, maxSteps: 50 });
    expect(result.maxSteps).toBe(50);
  });

  it('calls getToolsForAgent with agentType and toolContext', async () => {
    const mockRegistry = { getToolsForAgent: vi.fn().mockReturnValue({ Read: {}, Write: {} }) };
    mockBuildToolRegistry.mockReturnValueOnce(mockRegistry as unknown as ToolRegistry);

    await createAgentClient(baseConfig);

    expect(mockRegistry.getToolsForAgent).toHaveBeenCalledWith('coder', baseToolContext);
  });

  it('creates MCP clients when agent requires servers', async () => {
    const mockMcpClient = { serverId: 'context7', tools: { ctx7_tool: {} }, close: vi.fn() };
    mockGetRequiredMcpServers.mockReturnValueOnce(['context7']);
    mockCreateMcpClientsForAgent.mockResolvedValueOnce([mockMcpClient] as unknown as McpClientResult[]);
    mockMergeMcpTools.mockReturnValueOnce({ ctx7_tool: {} });

    const result = await createAgentClient(baseConfig);

    expect(mockCreateMcpClientsForAgent).toHaveBeenCalledWith('coder', expect.any(Object));
    expect(result.mcpClients).toHaveLength(1);
    expect(result.tools).toHaveProperty('ctx7_tool');
  });

  it('cleanup calls closeAllMcpClients with the client list', async () => {
    const result = await createAgentClient(baseConfig);
    await result.cleanup();
    expect(mockCloseAllMcpClients).toHaveBeenCalledWith(result.mcpClients);
  });

  it('uses queue-based auth when queueConfig is provided', async () => {
    const queueAuth = {
      apiKey: 'sk-queue-coder',
      source: 'profile-api-key' as const,
      accountId: 'acc-coder',
      resolvedProvider: 'anthropic' as const,
      resolvedModelId: 'claude-sonnet-4-5-20250929',
      reasoningConfig: { type: 'none' as const },
    };
    mockResolveAuthFromQueue.mockResolvedValueOnce(queueAuth);

    const result = await createAgentClient({
      ...baseConfig,
      queueConfig: {
        queue: [{ id: 'acc-coder' } as unknown as ProviderAccount],
        requestedModel: 'claude-sonnet-4-5-20250929',
      },
    });

    expect(result.queueAuth).toBe(queueAuth);
    expect(mockCreateProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          provider: 'anthropic',
          apiKey: 'sk-queue-coder',
        }),
        modelId: 'claude-sonnet-4-5-20250929',
      }),
    );
  });

  it('throws when queueConfig provided but no account available', async () => {
    mockResolveAuthFromQueue.mockResolvedValueOnce(null);

    await expect(
      createAgentClient({
        ...baseConfig,
        queueConfig: { queue: [], requestedModel: 'sonnet' },
      }),
    ).rejects.toThrow('No available account in priority queue');
  });

  it('merges additionalMcpServers into the required servers list', async () => {
    mockGetRequiredMcpServers.mockReturnValueOnce(['context7']);

    await createAgentClient({
      ...baseConfig,
      additionalMcpServers: ['custom-server'],
    });

    // createMcpClientsForAgent is called because the combined server list is non-empty
    expect(mockCreateMcpClientsForAgent).toHaveBeenCalled();
  });
});
