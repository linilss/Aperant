/**
 * Anthropic OAuth Token Detection
 *
 * Kept dependency-free so callers (provider factory, client factory, CLI routing)
 * can share it without pulling in the provider SDKs.
 */

/**
 * Detects if a credential is an Anthropic OAuth (Claude subscription) token vs an API key.
 * OAuth access tokens start with 'sk-ant-oa', refresh tokens with 'sk-ant-ort'.
 * API keys start with 'sk-ant-api'.
 */
export function isOAuthToken(token: string | undefined): boolean {
  if (!token) return false;
  return token.startsWith('sk-ant-oa') || token.startsWith('sk-ant-ort');
}
