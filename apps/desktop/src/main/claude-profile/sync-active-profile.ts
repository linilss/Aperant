/**
 * Keep the Claude profile manager's active profile aligned with the account queue.
 *
 * Two settings decide "which account": the provider account queue
 * (settings.globalPriorityOrder — what the header badge and Settings show) and
 * the profile manager's activeProfileId (what the Claude CLI runners for
 * roadmap, ideation and agents actually log in with). They drifted apart, so
 * the badge could say one account while CLI work ran on another.
 */

import type { ProviderAccount } from '../../shared/types/provider-account';
import { readSettingsFile } from '../settings-utils';
import { getClaudeProfileManager } from '../claude-profile-manager';

/**
 * Make the queue's #1 account the active CLI profile.
 *
 * @param order - Queue order to use; defaults to the saved globalPriorityOrder
 * @returns The profile id that is now active, or null when the #1 account has
 *          no linked Claude profile (e.g. an API-key account) and nothing changed
 */
export function syncActiveProfileToQueue(order?: string[]): string | null {
  const settings = readSettingsFile() ?? {};
  const queue = order ?? (settings.globalPriorityOrder as string[] | undefined) ?? [];
  const accounts = (settings.providerAccounts as ProviderAccount[] | undefined) ?? [];

  const primary = accounts.find((a) => a.id === queue[0]);
  const profileId = primary?.claudeProfileId;
  if (!profileId) return null;

  const manager = getClaudeProfileManager();
  if (manager.getActiveProfile()?.id !== profileId) {
    manager.setActiveProfile(profileId);
  }
  return profileId;
}
