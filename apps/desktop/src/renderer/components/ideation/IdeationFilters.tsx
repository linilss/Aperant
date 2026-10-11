import { useTranslation } from 'react-i18next';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs';
import { TypeIcon } from './TypeIcon';
import { ALL_IDEATION_TYPES } from './constants';

interface IdeationFiltersProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  children: React.ReactNode;
}

export function IdeationFilters({ activeTab, onTabChange, children }: IdeationFiltersProps) {
  const { t } = useTranslation('common');
  return (
    <Tabs value={activeTab} onValueChange={onTabChange} className="h-full flex flex-col">
      <TabsList className="shrink-0 mx-4 mt-4 flex-wrap h-auto gap-1">
        <TabsTrigger value="all">{t('ideation.tabs.all')}</TabsTrigger>
        {ALL_IDEATION_TYPES.map((type) => (
          <TabsTrigger key={type} value={type} className="[&_svg]:h-3 [&_svg]:w-3">
            <span className="mr-1 inline-flex">
              <TypeIcon type={type} />
            </span>
            {t(`ideation.tabs.${type}`)}
          </TabsTrigger>
        ))}
      </TabsList>
      {children}
    </Tabs>
  );
}
