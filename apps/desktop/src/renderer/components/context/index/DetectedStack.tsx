import { useState } from 'react';
import { AlertCircle, ChevronRight, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { Card, CardContent } from '../../ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../ui/collapsible';
import { cn } from '../../../lib/utils';
import { InfoItem } from '../InfoItem';
import { ServiceCard } from '../ServiceCard';
import type { ProjectIndex } from '../../../../shared/types';

function SectionTitle({ children }: { children: string }) {
  return <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{children}</h4>;
}

interface DetectedStackProps {
  projectIndex: ProjectIndex | null;
  indexLoading: boolean;
  indexError: string | null;
  onRefresh: () => void;
}

/** Static project-index analysis (services, infrastructure, conventions), collapsed by default */
export function DetectedStack({ projectIndex, indexLoading, indexError, onRefresh }: DetectedStackProps) {
  const { t } = useTranslation('context');
  const [open, setOpen] = useState(false);
  const services = Object.entries(projectIndex?.services ?? {});
  const infra = projectIndex?.infrastructure ?? {};
  const conventions = projectIndex?.conventions ?? {};

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center justify-between gap-3">
        <CollapsibleTrigger asChild>
          <button type="button" className="flex min-w-0 items-center gap-2 text-left">
            <ChevronRight
              className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
            />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-foreground">{t('index.detected.title')}</h3>
              <p className="truncate text-xs text-muted-foreground">{t('index.detected.subtitle')}</p>
            </div>
            {projectIndex && (
              <span className="flex shrink-0 gap-1">
                <Badge variant="outline" className="capitalize">
                  {projectIndex.project_type}
                </Badge>
                {services.length > 0 && (
                  <Badge variant="secondary">{t('index.detected.servicesCount', { count: services.length })}</Badge>
                )}
              </span>
            )}
          </button>
        </CollapsibleTrigger>
        <Button variant="ghost" size="sm" onClick={onRefresh} disabled={indexLoading} title={t('index.detected.refresh')}>
          <RefreshCw className={cn('h-3.5 w-3.5', indexLoading && 'animate-spin')} />
        </Button>
      </div>

      <CollapsibleContent className="mt-4 space-y-6">
        {indexError && (
          <div className="flex items-center gap-3 rounded-lg bg-destructive/10 p-4 text-destructive">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <div>
              <p className="font-medium">{t('index.detected.loadError')}</p>
              <p className="text-sm opacity-80">{indexError}</p>
            </div>
          </div>
        )}

        {!projectIndex && !indexLoading && !indexError && (
          <div className="flex flex-col items-center py-6 text-center">
            <p className="text-sm font-medium text-foreground">{t('index.detected.noIndex')}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t('index.detected.noIndexHint')}</p>
            <Button size="sm" className="mt-3" onClick={onRefresh}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              {t('index.detected.analyze')}
            </Button>
          </div>
        )}

        {projectIndex && (
          <>
            <p className="truncate font-mono text-xs text-muted-foreground">{projectIndex.project_root}</p>

            {services.length > 0 && (
              <div className="space-y-3">
                <SectionTitle>{t('index.detected.services')}</SectionTitle>
                <div className="grid gap-4 md:grid-cols-2">
                  {services.map(([name, service]) => (
                    <ServiceCard key={name} name={name} service={service} />
                  ))}
                </div>
              </div>
            )}

            {Object.keys(infra).length > 0 && (
              <div className="space-y-3">
                <SectionTitle>{t('index.detected.infrastructure')}</SectionTitle>
                <Card>
                  <CardContent className="pt-6">
                    <div className="grid gap-4 sm:grid-cols-2">
                      {infra.docker_compose && (
                        <InfoItem label={t('index.detected.dockerCompose')} value={infra.docker_compose} />
                      )}
                      {infra.ci && <InfoItem label={t('index.detected.ci')} value={infra.ci} />}
                      {infra.deployment && <InfoItem label={t('index.detected.deployment')} value={infra.deployment} />}
                      {infra.docker_services && infra.docker_services.length > 0 && (
                        <div className="sm:col-span-2">
                          <span className="text-xs text-muted-foreground">{t('index.detected.dockerServices')}</span>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {infra.docker_services.map((svc) => (
                              <Badge key={svc} variant="secondary" className="text-xs">
                                {svc}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {Object.keys(conventions).length > 0 && (
              <div className="space-y-3">
                <SectionTitle>{t('index.detected.conventions')}</SectionTitle>
                <Card>
                  <CardContent className="pt-6">
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {conventions.python_linting && (
                        <InfoItem label={t('index.detected.pythonLinting')} value={conventions.python_linting} />
                      )}
                      {conventions.js_linting && (
                        <InfoItem label={t('index.detected.jsLinting')} value={conventions.js_linting} />
                      )}
                      {conventions.formatting && (
                        <InfoItem label={t('index.detected.formatting')} value={conventions.formatting} />
                      )}
                      {conventions.git_hooks && (
                        <InfoItem label={t('index.detected.gitHooks')} value={conventions.git_hooks} />
                      )}
                      {conventions.typescript && (
                        <InfoItem label={t('index.detected.typescript')} value={t('index.detected.enabled')} />
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
