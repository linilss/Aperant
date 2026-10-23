import { describe, expect, it } from 'vitest';
import type { ProjectIndex, ServiceInfo } from '../../../../shared/types';
import { PROJECT_INDEX_SUMMARY_MAX_CHARS, summarizeProjectIndex } from '../project-index-summary';

function bulkyService(overrides: Partial<ServiceInfo>): ServiceInfo {
  return {
    name: 'svc',
    path: 'svc',
    dependencies: Array.from({ length: 80 }, (_, i) => `dep-${i}`),
    dev_dependencies: Array.from({ length: 40 }, (_, i) => `dev-dep-${i}`),
    environment: {
      detected_count: 30,
      variables: Object.fromEntries(
        Array.from({ length: 30 }, (_, i) => [`ENV_${i}`, { type: 'string', sensitive: false, required: true }]),
      ),
    },
    api: {
      total_routes: 50,
      routes: Array.from({ length: 50 }, (_, i) => ({ path: `/api/r${i}`, methods: ['GET', 'POST'] })),
    },
    ...overrides,
  };
}

const monorepo: ProjectIndex = {
  project_root: '/repo',
  project_type: 'monorepo',
  services: {
    web: bulkyService({
      name: 'web',
      path: '/repo/apps/web',
      language: 'TypeScript',
      framework: 'Next.js',
      type: 'frontend',
      package_manager: 'pnpm',
      entry_point: 'src/app/page.tsx',
      testing: 'Vitest',
      key_directories: {
        src: { path: 'src', purpose: 'Source code' },
        components: { path: 'src/components', purpose: 'UI components' },
      },
    }),
    api: bulkyService({
      name: 'api',
      path: 'services/api',
      language: 'Python',
      framework: 'FastAPI',
      type: 'backend',
      package_manager: 'uv',
      entry_point: 'app/main.py',
      testing: 'pytest',
    }),
    shared: bulkyService({ name: 'shared', path: 'packages/shared', language: 'TypeScript', type: 'library' }),
  },
  infrastructure: { ci: 'GitHub Actions', ci_workflows: ['ci.yml'], docker_compose: 'docker-compose.yml' },
  conventions: { js_linting: 'Biome', typescript: true },
};

describe('summarizeProjectIndex', () => {
  it('lists project type, services with stack/entry points/key dirs, infra and conventions', () => {
    const summary = summarizeProjectIndex(JSON.stringify(monorepo, null, 2));
    expect(summary).not.toBeNull();
    expect(summary).toContain('Project type: monorepo (3 services)');
    expect(summary).toContain(
      '- web (apps/web): TypeScript / Next.js; frontend; pm: pnpm; entry: src/app/page.tsx; tests: Vitest; dirs: src (Source code), src/components (UI components)',
    );
    expect(summary).toContain('- api (services/api): Python / FastAPI; backend; pm: uv; entry: app/main.py; tests: pytest');
    expect(summary).toContain('- shared (packages/shared): TypeScript; library');
    expect(summary).toContain('CI: GitHub Actions');
    expect(summary).toContain('docker compose: docker-compose.yml');
    expect(summary).toContain('lint: Biome');
  });

  it('leaves out bulky details (dependencies, routes, env vars) and is much smaller than the index', () => {
    const full = JSON.stringify(monorepo, null, 2);
    const summary = summarizeProjectIndex(full) ?? '';
    expect(summary).not.toContain('dep-0');
    expect(summary).not.toContain('/api/r0');
    expect(summary).not.toContain('ENV_0');
    expect(summary.length).toBeLessThan(full.length / 10);
  });

  it('caps the summary and counts services that did not fit', () => {
    const services = Object.fromEntries(
      Array.from({ length: 100 }, (_, i) => [
        `service-${i}`,
        bulkyService({ name: `service-${i}`, path: `packages/service-${i}`, language: 'TypeScript', framework: 'Express' }),
      ]),
    );
    const summary = summarizeProjectIndex({ ...monorepo, services }) ?? '';
    expect(summary.length).toBeLessThanOrEqual(PROJECT_INDEX_SUMMARY_MAX_CHARS);
    expect(summary).toContain('- service-0 (packages/service-0)');
    expect(summary).toMatch(/- \.\.\. \d+ more service\(s\) in the full index$/);
  });

  it('handles a single project with no services', () => {
    const summary = summarizeProjectIndex({
      project_root: '/p',
      project_type: 'single',
      services: {},
      infrastructure: {},
      conventions: {},
    });
    expect(summary).toBe('Project type: single (0 services)');
  });

  it('returns null for unparseable input', () => {
    expect(summarizeProjectIndex('{not json')).toBeNull();
    expect(summarizeProjectIndex('null')).toBeNull();
  });
});
