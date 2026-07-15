'use client';

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { translate, type MessageKey, type TranslateVars } from '@/i18n/messages';

export type Theme = 'light' | 'dark';
export type Locale = 'ar' | 'en';

type PreferenceCookies = {
  sh_theme: Theme;
  sh_locale: Locale;
};

export type Translator = (key: MessageKey, vars?: TranslateVars) => string;

interface PreferencesContextValue {
  theme: Theme;
  locale: Locale;
  setTheme: (theme: Theme) => void;
  setLocale: (locale: Locale) => void;
  /** Translate a static UI string in the current locale. */
  t: Translator;
}

interface PreferencesProviderProps {
  children: ReactNode;
  initialTheme: Theme;
  initialLocale: Locale;
}

const PreferencesContext = createContext<PreferencesContextValue | undefined>(undefined);
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

function writePreferenceCookie<Name extends keyof PreferenceCookies>(
  name: Name,
  value: PreferenceCookies[Name],
): void {
  document.cookie = `${name}=${value}; Max-Age=${COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax`;
}

export function PreferencesProvider({
  children,
  initialTheme,
  initialLocale,
}: PreferencesProviderProps) {
  const [theme, setThemeState] = useState<Theme>(initialTheme);
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.lang = locale;
    root.dir = locale === 'ar' ? 'rtl' : 'ltr';
  }, [locale, theme]);

  const setTheme = useCallback((nextTheme: Theme) => {
    setThemeState(nextTheme);
    writePreferenceCookie('sh_theme', nextTheme);
  }, []);

  const setLocale = useCallback((nextLocale: Locale) => {
    setLocaleState(nextLocale);
    writePreferenceCookie('sh_locale', nextLocale);
  }, []);

  const t = useCallback<Translator>(
    (key, vars) => translate(locale, key, vars),
    [locale],
  );

  const value = useMemo(
    () => ({ theme, locale, setTheme, setLocale, t }),
    [locale, setLocale, setTheme, t, theme],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  const context = useContext(PreferencesContext);
  if (context === undefined) {
    throw new Error('usePreferences must be used within a PreferencesProvider');
  }
  return context;
}