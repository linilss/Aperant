import { describe, expect, it } from 'vitest';
import {
  RELEASE_DISALLOWED_TOOLS,
  findReleaseCommand,
  isReleaseStepText,
  releaseGuardCliArgs,
  taskAgentCliToolArgs,
} from '../release-guard';
import { bashSecurityHook, validateCommand } from '../bash-validator';

const BLOCKED = [
  'git push',
  'git push origin main',
  'git push --dry-run',
  'git -C /repo push origin main',
  'cd backend && git push',
  'npm test && git push origin HEAD',
  './deploy.sh',
  './deploy.sh --prod',
  'bash deploy.sh',
  'sh ./scripts/deploy-api.sh',
  'apple/deploy-ios.sh',
  './deploy.sh then scripts/smoke-prod.sh',
  'scripts/release.sh 1.2.3',
  'FOO=1 ./publish.sh',
  'npm run deploy',
  'pnpm run release',
  'make deploy',
  'az webapp deploy --name x',
  'az acr build -r reg .',
  'xcrun altool --upload-app -f app.ipa',
  'npm publish',
  'npx vercel --prod',
  'vercel deploy',
  'fly deploy',
  'kubectl apply -f k8s/',
  'terraform apply -auto-approve',
  'dotnet nuget push pkg.nupkg',
  'docker push reg/app:1',
  'fastlane pilot upload',
  'gh release create v1',
];

const ALLOWED = [
  'git status',
  'git diff HEAD~1',
  'git commit -m "push the button"',
  'git log --oneline',
  'git add -A && git commit -m "Add deploy docs"',
  'dotnet test',
  'dotnet build -c Release',
  'npm test',
  'npm run build',
  'npm run lint',
  'make test',
  'ls scripts',
  'az account show',
  'kubectl get pods',
  'terraform plan',
  'docker build -t app .',
  'grep -r "TODO" src',
];

describe('findReleaseCommand', () => {
  it.each(BLOCKED)('blocks %s', (cmd) => {
    expect(findReleaseCommand(cmd)).not.toBeNull();
  });

  it.each(ALLOWED)('allows %s', (cmd) => {
    expect(findReleaseCommand(cmd)).toBeNull();
  });
});

describe('bash validator (SDK path)', () => {
  it('denies release commands with the release reason', () => {
    const result = bashSecurityHook({ toolName: 'Bash', toolInput: { command: 'cd api && ./deploy.sh' } });
    expect(result).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
    expect(JSON.stringify(result)).toContain('Deploy button');
    expect(validateCommand('git push origin main')[0]).toBe(false);
  });

  it('still allows normal commands', () => {
    expect(bashSecurityHook({ toolName: 'Bash', toolInput: { command: 'dotnet test' } })).toEqual({});
    expect(validateCommand('git status')[0]).toBe(true);
  });
});

describe('CLI deny patterns', () => {
  it('covers the listed release commands', () => {
    for (const pattern of [
      'Bash(git push:*)',
      'Bash(./deploy*)',
      'Bash(*/deploy*.sh*)',
      'Bash(az webapp:*)',
      'Bash(az acr:*)',
      'Bash(xcrun altool:*)',
      'Bash(npm publish:*)',
      'Bash(fly deploy:*)',
      'Bash(vercel:*)',
      'Bash(kubectl apply:*)',
      'Bash(terraform apply:*)',
      'Bash(dotnet nuget push:*)',
    ]) {
      expect(RELEASE_DISALLOWED_TOOLS).toContain(pattern);
    }
  });

  it('passes them via --disallowedTools for task agents (Bash allowed)', () => {
    expect(releaseGuardCliArgs()[0]).toBe('--disallowedTools');
    const args = taskAgentCliToolArgs();
    expect(args[args.indexOf('--allowedTools') + 1]).toContain('Bash');
    expect(args[args.indexOf('--disallowedTools') + 1]).toContain('Bash(git push:*)');
  });
});

describe('isReleaseStepText (plan subtasks)', () => {
  it.each([
    './deploy.sh then scripts/smoke-prod.sh (deploy backend first, backward-compatible API)',
    'apple/deploy-ios.sh; wait for VALID build in TestFlight.',
    'Commit and push to main; report deployed version and TestFlight build',
    'Deploy to production',
    'Upload the build to App Store Connect',
    'Run npm publish',
  ])('flags %s', (text) => {
    expect(isReleaseStepText(text)).toBe(true);
  });

  it.each([
    'Update docs/api.md',
    'dotnet test (Postgres container must be running)',
    'Update deploy.sh to also run migrations',
    'Add a deploy section to the README',
    'Implement the release notes screen',
    'Create the workout history API endpoint',
    'Run the frontend test suite',
  ])('does not flag %s', (text) => {
    expect(isReleaseStepText(text)).toBe(false);
  });
});
