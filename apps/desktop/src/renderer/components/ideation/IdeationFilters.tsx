import { useTranslation } from 'react-i18next';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs';
import { PAGE_BODY, PAGE_STICKY } from '../ui/page-header';
import { cn } from '../../lib/utils';
import { TypeIcon } from './TypeIcon';
import { ALL_IDEATION_TYPES } from './constants';

interface IdeationFiltersProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  children: React.ReactNode;
}

/**
 * Type tabs + content. Desktop: tabs wrap above a scrolling body. Phone: the tab row is a
 * single sideways-scrolling line pinned to the top while the page scrolls.
 */
export function IdeationFilters({ activeTab, onTabChange, children }: IdeationFiltersProps) {
  const { t } = useTranslation('common');
  return (
    <Tabs value={activeTab} onValueChange={onTabChange} className={cn('flex flex-col', PAGE_BODY)}>
      <div className={cn('shrink-0 px-4 pt-4 max-md:px-3 max-md:py-2', PAGE_STICKY)}>
        <TabsList
          className={cn(
            'h-auto w-full flex-wrap gap-1',
            'max-md:flex-nowrap max-md:justify-start max-md:overflow-x-auto max-md:[scrollbar-width:none] max-md:[&::-webkit-scrollbar]:hidden'
          )}
        >
          <TabsTrigger value="all" className="shrink-0 max-md:h-9">
            {t('ideation.tabs.all')}
          </TabsTrigger>
          {ALL_IDEATION_TYPES.map((type) => (
            <TabsTrigger key={type} value={type} className="shrink-0 max-md:h-9 [&_svg]:h-3 [&_svg]:w-3">
              <span className="mr-1 inline-flex">
                <TypeIcon type={type} />
              </span>
              {t(`ideation.tabs.${type}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {children}
    </Tabs>
  );
}
