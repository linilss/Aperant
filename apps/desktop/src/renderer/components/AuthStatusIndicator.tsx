/**
 * AuthStatusIndicator - Display current authentication method in header
 *
 * Shows the active provider from the global priority queue. The badge reflects
 * the first account in globalPriorityOrder that exists in providerAccounts.
 *
 * Usage warning badge: Shows to the left of provider badge when usage exceeds 90%
 */

import { useMemo, useState, useEffect } from 'react';
import { AlertTriangle, Check, Key, Lock, Shield, Server } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { useToast } from '../hooks/use-toast';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../stores/settings-store';
import { useActiveProvider } from '../hooks/useActiveProvider';
import { formatTimeRemaining, localizeUsageWindowLabel, hasHardcodedText } from '../../shared/utils/format-time';
import type { ClaudeUsageSnapshot } from '../../shared/types/agent';

const PROVIDER_BADGE_COLORS: Record<string, string> = {
  'anthropic': 'bg-orange-500/10 text-orange-500 border-orange-500/20 hover:bg-orange-500/15',
  'openai': 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20 hover:bg-emerald-500/15',
  'google': 'bg-blue-500/10 text-blue-500 border-blue-500/20 hover:bg-blue-500/15',
  'zai': 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20 hover:bg-indigo-500/15',
  'openrouter': 'bg-violet-500/10 text-violet-500 border-violet-500/20 hover:bg-violet-500/15',
  'mistral': 'bg-amber-500/10 text-amber-500 border-amber-500/20 hover:bg-amber-500/15',
  'groq': 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20 hover:bg-yellow-500/15',
  'xai': 'bg-slate-500/10 text-slate-500 border-slate-500/20 hover:bg-slate-500/15',
  'amazon-bedrock': 'bg-orange-600/10 text-orange-600 border-orange-600/20 hover:bg-orange-600/15',
  'azure': 'bg-sky-500/10 text-sky-500 border-sky-500/20 hover:bg-sky-500/15',
  'ollama': 'bg-purple-500/10 text-purple-500 border-purple-500/20 hover:bg-purple-500/15',
  'openai-compatible': 'bg-gray-500/10 text-gray-500 border-gray-500/20 hover:bg-gray-500/15',
};

const PROVIDER_I18N_KEYS: Record<string, string> = {
  'anthropic': 'common:usage.providerAnthropic',
  'openai': 'common:usage.providerOpenAI',
  'google': 'common:usage.providerGoogle',
  'zai': 'common:usage.providerZai',
  'openrouter': 'common:usage.providerOpenRouter',
  'mistral': 'common:usage.providerMistral',
  'groq': 'common:usage.providerGroq',
  'xai': 'common:usage.providerXai',
  'amazon-bedrock': 'common:usage.providerBedrock',
  'azure': 'common:usage.providerAzure',
  'ollama': 'common:usage.providerOllama',
  'openai-compatible': 'common:usage.providerCustomEndpoint',
};

export function AuthStatusIndicator() {
  const { providerAccounts, settings, setQueueOrder } = useSettingsStore();
  const { t } = useTranslation(['common']);
  const { toast } = useToast();

  // Track usage data for warning badge
  const [usage, setUsage] = useState<ClaudeUsageSnapshot | null>(null);
  const [isLoadingUsage, setIsLoadingUsage] = useState(true);

  // Listen for usage updates
  useEffect(() => {
    const unsubscribe = window.electronAPI.onUsageUpdated((snapshot: ClaudeUsageSnapshot) => {
      setUsage(snapshot);
      setIsLoadingUsage(false);
    });

    // Request initial usage
    window.electronAPI.requestUsageUpdate()
      .then((result) => {
        if (result.success && result.data) {
          setUsage(result.data);
        }
      })
      .catch((error) => {
        console.warn('[AuthStatusIndicator] Failed to fetch usage:', error);
      })
      .finally(() => {
        setIsLoadingUsage(false);
      });

    return () => {
      unsubscribe();
    };
  }, []);

  // Determine if usage warning badge should be shown
  const shouldShowUsageWarning = usage && !isLoadingUsage && (
    usage.sessionPercent >= 90 || usage.weeklyPercent >= 90
  );

  // Get the higher usage percentage for the warning badge
  const warningBadgePercent = usage
    ? Math.max(usage.sessionPercent, usage.weeklyPercent)
    : 0;

  // Get formatted reset times (calculated dynamically from timestamps)
  const sessionResetTime = usage?.sessionResetTimestamp
    ? (formatTimeRemaining(usage.sessionResetTimestamp, t) ??
      (hasHardcodedText(usage?.sessionResetTime) ? undefined : usage?.sessionResetTime))
    : (hasHardcodedText(usage?.sessionResetTime) ? undefined : usage?.sessionResetTime);

  const { account: activeAccount } = useActiveProvider();

  const isCrossProviderMode = settings.customMixedProfileActive && !!settings.customMixedPhaseConfig;
  const crossProviderList = isCrossProviderMode
    ? [...new Set(Object.values(settings.customMixedPhaseConfig!).map((phase) => phase.provider))]
    : [];
  const crossProviderLabel = crossProviderList
    .map((provider) => PROVIDER_I18N_KEYS[provider] ?? provider)
    .map((key) => t(key))
    .join(', ');

  const Icon = !activeAccount ? Server : activeAccount.authType === 'oauth' ? Lock : Key;

  const badgeLabel = isCrossProviderMode
    ? t('common:usage.crossProvider')
    : activeAccount
      ? t(PROVIDER_I18N_KEYS[activeAccount.provider] ?? 'common:usage.providerUnknown')
      : t('common:usage.noAccount');
  const badgeColor = isCrossProviderMode
    ? 'bg-blue-500/10 text-blue-500 border-blue-500/20 hover:bg-blue-500/15'
    : (activeAccount
      ? (PROVIDER_BADGE_COLORS[activeAccount.provider] ?? PROVIDER_BADGE_COLORS['openai-compatible'])
      : 'bg-muted text-muted-foreground border-border');

  // Queue position info
  const queuePosition = useMemo(() => {
    if (!activeAccount) return null;
    const order = settings.globalPriorityOrder ?? [];
    const pos = order.indexOf(activeAccount.id);
    return { position: pos >= 0 ? pos + 1 : 1, total: providerAccounts.length };
  }, [activeAccount, settings.globalPriorityOrder, providerAccounts.length]);

  // Accounts in queue order. The active account is simply #1 in the queue, so
  // switching is a reorder — independent of automatic account switching.
  const orderedAccounts = useMemo(() => {
    const order = settings.globalPriorityOrder ?? [];
    const byId = new Map(providerAccounts.map((a) => [a.id, a]));
    const inOrder = order.map((id) => byId.get(id)).filter((a): a is NonNullable<typeof a> => !!a);
    const rest = providerAccounts.filter((a) => !order.includes(a.id));
    return [...inOrder, ...rest];
  }, [providerAccounts, settings.globalPriorityOrder]);

  const handleSwitchAccount = async (accountId: string) => {
    if (accountId === activeAccount?.id) return;
    const newOrder = [accountId, ...orderedAccounts.map((a) => a.id).filter((id) => id !== accountId)];
    const result = await setQueueOrder(newOrder);
    if (!result.success) {
      toast({
        variant: 'destructive',
        title: t('common:usage.switchAccountFailed'),
        description: result.error,
      });
    }
  };

  return (
    <div className="flex items-center gap-2">
      {/* Usage Warning Badge (shown when usage >= 90%) */}
      {shouldShowUsageWarning && (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border bg-red-500/10 text-red-500 border-red-500/20">
                <AlertTriangle className="h-3.5 w-3.5 motion-safe:animate-pulse" />
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs max-w-xs">
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground font-medium">{t('common:usage.usageAlert')}</span>
                  <span className="font-semibold text-red-500">{Math.round(warningBadgePercent)}%</span>
                </div>
                <div className="h-px bg-border" />
                <div className="text-[10px] text-muted-foreground">
                  {t('common:usage.accountExceedsThreshold')}
                </div>
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      {/* Provider Badge — hover for details, click to switch account */}
      <DropdownMenu>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border transition-all hover:opacity-80 ${badgeColor}`}
              aria-label={t('common:usage.authenticationAriaLabel', { provider: badgeLabel })}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="text-xs font-semibold">
                {badgeLabel}
              </span>
            </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs max-w-xs p-0">
            <div className="p-3 space-y-3">
              {/* Header section */}
              <div className="flex items-center justify-between pb-2 border-b">
                <div className="flex items-center gap-1.5">
                  <Shield className="h-3.5 w-3.5" />
                  <span className="font-semibold text-xs">{t('common:usage.authenticationDetails')}</span>
                </div>
                {activeAccount && (
                  <div className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                    activeAccount.authType === 'oauth'
                      ? 'bg-orange-500/15 text-orange-500'
                      : 'bg-primary/15 text-primary'
                  }`}>
                    {activeAccount.authType === 'oauth'
                      ? t('common:usage.oauth')
                      : t('common:usage.apiKey')}
                  </div>
                )}
              </div>

              {activeAccount ? (
                <>
                  {/* Provider info */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-1.5 text-muted-foreground">
                      <Server className="h-3.5 w-3.5 mt-0.5" />
                      <div className="text-left">
                        <span className="font-medium text-[11px]">
                          {isCrossProviderMode ? t('common:usage.crossProviderConfig') : t('common:usage.provider')}
                        </span>
                        {isCrossProviderMode ? (
                          <div className="mt-1 text-xs text-foreground/90">
                            {crossProviderLabel}
                          </div>
                        ) : (
                          <div className="text-xs text-foreground/90">{badgeLabel}</div>
                        )}
                      </div>
                    </div>

                    {isCrossProviderMode && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold bg-blue-500/10 text-blue-500 border border-blue-500/20">
                        {t('common:usage.crossProvider')}
                      </span>
                    )}
                  </div>

                  {/* Billing model */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Key className="h-3 w-3" />
                      <span className="text-[10px]">{t('common:usage.subscription')}</span>
                    </div>
                    <span className="font-medium text-[10px]">
                      {activeAccount.billingModel === 'subscription'
                        ? t('common:usage.billingSubscription')
                        : t('common:usage.billingPayPerUse')}
                    </span>
                  </div>

                  {/* Account name */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Lock className="h-3 w-3" />
                      <span className="text-[10px]">{t('common:usage.accountName')}</span>
                    </div>
                    <span className="font-medium text-[10px]">{activeAccount.name}</span>
                  </div>

                  {/* Queue position */}
                  {queuePosition && (
                    <div className="flex items-center justify-between pt-2 border-t">
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <span className="text-[10px]">{t('common:usage.queuePosition')}</span>
                      </div>
                      <span className="font-medium text-[10px]">
                        #{queuePosition.position} of {queuePosition.total}
                      </span>
                    </div>
                  )}
                  {orderedAccounts.length > 1 && (
                    <div className="text-[10px] text-muted-foreground">
                      {t('common:usage.clickToSwitchAccount')}
                    </div>
                  )}
                </>
              ) : (
                <div className="text-[11px] text-muted-foreground">
                  {t('common:usage.noAccountDescription')}
                </div>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>{t('common:usage.switchAccount')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {orderedAccounts.map((account) => {
          const isActive = account.id === activeAccount?.id;
          return (
            <DropdownMenuItem
              key={account.id}
              onClick={() => handleSwitchAccount(account.id)}
              className="flex items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <div className="truncate text-sm">{account.name}</div>
                <div className="text-[10px] text-muted-foreground">
                  {t(PROVIDER_I18N_KEYS[account.provider] ?? 'common:usage.providerUnknown')}
                  {' · '}
                  {account.authType === 'oauth' ? t('common:usage.oauth') : t('common:usage.apiKey')}
                </div>
              </div>
              {isActive && <Check className="h-4 w-4 shrink-0 text-primary" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
      </DropdownMenu>

      {/* 5 Hour Usage Badge (shown when session usage >= 90%) */}
      {usage && !isLoadingUsage && usage.sessionPercent >= 90 && (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border bg-red-500/10 text-red-500 border-red-500/20 text-xs font-semibold">
                {Math.round(usage.sessionPercent)}%
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs max-w-xs">
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground font-medium">{localizeUsageWindowLabel(usage?.usageWindows?.sessionWindowLabel, t)}</span>
                  <span className="font-semibold text-red-500">{Math.round(usage.sessionPercent)}%</span>
                </div>
                {sessionResetTime && (
                  <>
                    <div className="h-px bg-border" />
                    <div className="text-[10px] text-muted-foreground">
                      {sessionResetTime}
                    </div>
                  </>
                )}
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}
