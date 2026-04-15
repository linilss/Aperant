import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { TestConfig } from '../../../shared/types/tests';

const CONFIG_RELATIVE_PATH = path.join('.malvy', 'tests', 'config.json');

const DEFAULT_CONFIG: TestConfig = {
  categories: ['Unit', 'Integration', 'E2E', 'Interface'],
};

function configPath(projectDir: string): string {
  return path.join(projectDir, CONFIG_RELATIVE_PATH);
}

/**
 * Reads the test config from `.malvy/tests/config.json`.
 * Returns the default config when the file is missing or unreadable.
 */
export async function getTestConfig(projectDir: string): Promise<TestConfig> {
  try {
    const content = await fs.readFile(configPath(projectDir), 'utf-8');
    return JSON.parse(content) as TestConfig;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Persists the test config to `.malvy/tests/config.json`.
 * Creates parent directories if they do not exist.
 */
export async function saveTestConfig(projectDir: string, config: TestConfig): Promise<void> {
  const filePath = configPath(projectDir);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(config, null, 2), 'utf-8');
}
