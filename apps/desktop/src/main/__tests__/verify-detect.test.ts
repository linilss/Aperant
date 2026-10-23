import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { detectVerifyCommand, resolveVerifyCommand } from '../verify-detect';

let dir = '';
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const project = (files: Record<string, string>) => {
  dir = mkdtempSync(path.join(tmpdir(), 'verify-detect-'));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), content);
  }
  return dir;
};

describe('detectVerifyCommand', () => {
  it('runs .NET test projects (not the whole solution)', () => {
    const p = project({ 'App.sln': '', 'App/App.csproj': '', 'App.Tests/App.Tests.csproj': '', 'tests/Api.Tests/Api.Tests.csproj': '' });
    expect(detectVerifyCommand(p)).toBe('dotnet test "App.Tests/App.Tests.csproj" -v q -nologo && dotnet test "tests/Api.Tests/Api.Tests.csproj" -v q -nologo');
  });

  it('uses Node typecheck and test scripts, skipping the npm placeholder', () => {
    expect(detectVerifyCommand(project({ 'package.json': JSON.stringify({ scripts: { typecheck: 'tsc', test: 'vitest' } }) }))).toBe('npm run typecheck && npm test');
    rmSync(dir, { recursive: true, force: true });
    expect(detectVerifyCommand(project({ 'package.json': JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }) }))).toBeUndefined();
  });

  it('honours the setting: a command wins, "none" turns it off, empty detects', () => {
    const p = project({ 'Package.swift': '' });
    expect(resolveVerifyCommand('make check', p)).toBe('make check');
    expect(resolveVerifyCommand('none', p)).toBeUndefined();
    expect(resolveVerifyCommand('', p)).toBe('swift test');
  });
});
