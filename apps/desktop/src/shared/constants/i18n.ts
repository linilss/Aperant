/**
 * Internationalization constants
 */

export type SupportedLanguage = 'en';

export const AVAILABLE_LANGUAGES = [
  { value: 'en' as const, label: 'English', nativeLabel: 'English' }
] as const;

export const DEFAULT_LANGUAGE: SupportedLanguage = 'en';
