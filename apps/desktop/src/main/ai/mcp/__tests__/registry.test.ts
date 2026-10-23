/**
 * Tests for MCP Server Registry
 *
 * Validates server configuration resolution, required server lookup,
 * and option-based server filtering.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// The malvy server is only offered when its bundled script exists on disk
let serverScriptExists = true;
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: (p: string) => (String(p).endsWith('malvy-mcp-server.js') ? serverScriptExists : actual.existsSync(p)),
  };
});

import { getMcpServerConfig, resolveMcpServers } from '../registry';

// =============================================================================
// getMcpServerConfig
// =============================================================================

describe('getMcpServerConfig', () => {
  describe('context7', () => {
    it('returns the context7 server config', () => {
      const config = getMcpServerConfig('context7');
      expect(config).not.toBeNull();
      expect(config?.id).toBe('context7');
      expect(config?.enabledByDefault).toBe(true);
    });

    it('uses stdio transport with npx', () => {
      const config = getMcpServerConfig('context7');
      expect(config?.transport.type).toBe('stdio');
      if (config?.transport.type === 'stdio') {
        expect(config.transport.command).toBe('npx');
      }
    });
  });

  describe('memory', () => {
    it('is not an MCP server (built-in memory is injected into prompts instead)', () => {
      expect(getMcpServerConfig('memory', { env: { GRAPHITI_MCP_URL: 'http://graphiti.local' } })).toBeNull();
    });
  });

  describe('electron', () => {
    it('returns the electron server config', () => {
      const config = getMcpServerConfig('electron');
      expect(config).not.toBeNull();
      expect(config?.id).toBe('electron');
      expect(config?.enabledByDefault).toBe(false);
    });

    it('uses stdio transport', () => {
      const config = getMcpServerConfig('electron');
      expect(config?.transport.type).toBe('stdio');
    });
  });

  describe('puppeteer', () => {
    it('returns the puppeteer server config', () => {
      const config = getMcpServerConfig('puppeteer');
      expect(config).not.toBeNull();
      expect(config?.id).toBe('puppeteer');
    });

    it('uses stdio transport', () => {
      const config = getMcpServerConfig('puppeteer');
      expect(config?.transport.type).toBe('stdio');
    });
  });

  describe('malvy', () => {
    beforeEach(() => {
      serverScriptExists = true;
    });

    it('returns the malvy config with empty specDir as default', () => {
      const config = getMcpServerConfig('malvy', {});
      expect(config).not.toBeNull();
      expect(config?.id).toBe('malvy');
      if (config?.transport.type === 'stdio') {
        expect(config.transport.env?.SPEC_DIR).toBe('');
      }
    });

    it('injects SPEC_DIR into transport env', () => {
      const config = getMcpServerConfig('malvy', { specDir: '/project/.malvy/specs/001-feature' });
      expect(config?.transport.type).toBe('stdio');
      if (config?.transport.type === 'stdio') {
        expect(config.transport.env?.SPEC_DIR).toBe('/project/.malvy/specs/001-feature');
      }
    });

    it('uses node command with the bundled server script', () => {
      const config = getMcpServerConfig('malvy', {});
      expect(config?.transport.type).toBe('stdio');
      if (config?.transport.type === 'stdio') {
        expect(config.transport.command).toBe('node');
        expect(config.transport.args?.[0]).toMatch(/malvy-mcp-server\.js$/);
      }
    });

    it('returns null when malvy-mcp-server.js has not been built', () => {
      serverScriptExists = false;
      expect(getMcpServerConfig('malvy', { specDir: '/x' })).toBeNull();
    });

    it('does not recognize the legacy auto-claude id', () => {
      expect(getMcpServerConfig('auto-claude', {})).toBeNull();
    });
  });

  describe('unknown server', () => {
    it('returns null for unrecognized server ID', () => {
      const config = getMcpServerConfig('nonexistent-server');
      expect(config).toBeNull();
    });
  });

  it('drops the malvy server when its script is missing', () => {
    serverScriptExists = false;
    const configs = resolveMcpServers(['context7', 'malvy'], { specDir: '/x' });
    expect(configs.map((c) => c.id)).toEqual(['context7']);
  });
});

// =============================================================================
// resolveMcpServers
// =============================================================================

describe('resolveMcpServers', () => {
  it('returns configs for all recognized server IDs', () => {
    const configs = resolveMcpServers(['context7', 'electron', 'puppeteer']);
    expect(configs).toHaveLength(3);
    expect(configs.map((c) => c.id)).toEqual(['context7', 'electron', 'puppeteer']);
  });

  it('filters out servers that cannot be configured (e.g. memory without URL)', () => {
    const configs = resolveMcpServers(['context7', 'memory'], {});
    expect(configs).toHaveLength(1);
    expect(configs[0].id).toBe('context7');
  });

  it('returns empty array for empty input', () => {
    const configs = resolveMcpServers([]);
    expect(configs).toEqual([]);
  });

  it('skips unrecognized server IDs silently', () => {
    const configs = resolveMcpServers(['context7', 'bogus-server-id']);
    expect(configs).toHaveLength(1);
    expect(configs[0].id).toBe('context7');
  });

  it('passes specDir through to the malvy config', () => {
    serverScriptExists = true;
    const specDir = '/my-project/.malvy/specs/042-auth';
    const configs = resolveMcpServers(['malvy'], { specDir });
    expect(configs).toHaveLength(1);
    if (configs[0].transport.type === 'stdio') {
      expect(configs[0].transport.env?.SPEC_DIR).toBe(specDir);
    }
  });

  it('drops the malvy server when its script is missing', () => {
    serverScriptExists = false;
    const configs = resolveMcpServers(['context7', 'malvy'], { specDir: '/x' });
    expect(configs.map((c) => c.id)).toEqual(['context7']);
  });
});
