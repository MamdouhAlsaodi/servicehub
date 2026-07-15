'use client';

import { usePreferences } from '@/contexts/PreferencesContext';

function ThemeIcon({ theme }: { theme: 'light' | 'dark' }) {
  if (theme === 'dark') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none">
        <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
        <path
          d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none">
      <path
        d="M20.5 15.2A8.5 8.5 0 0 1 8.8 3.5 8.5 8.5 0 1 0 20.5 15.2Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function GlobalPreferencesMenu() {
  const { theme, locale, setTheme, setLocale, t } = usePreferences();
  const nextTheme = theme === 'dark' ? 'light' : 'dark';
  const nextLocale = locale === 'ar' ? 'en' : 'ar';
  const sep = locale === 'ar' ? '؛ ' : '; ';
  const themeAria = `${t(theme === 'dark' ? 'preferences.themeCurrentDark' : 'preferences.themeCurrentLight')}${sep}${t(nextTheme === 'dark' ? 'preferences.themeSwitchDark' : 'preferences.themeSwitchLight')}`;
  const localeAria = t(nextLocale === 'en' ? 'preferences.localeSwitchToEn' : 'preferences.localeSwitchToAr');

  return (
    <div className="global-preferences-menu" role="group" aria-label={t('preferences.groupAria')}>
      <button
        type="button"
        className="global-preference-button"
        onClick={() => setTheme(nextTheme)}
        aria-label={themeAria}
        title={themeAria}
      >
        <ThemeIcon theme={theme} />
        <span>{t(nextTheme === 'light' ? 'preferences.themeLightLabel' : 'preferences.themeDarkLabel')}</span>
      </button>
      <button
        type="button"
        className="global-preference-button global-preference-locale"
        onClick={() => setLocale(nextLocale)}
        aria-label={localeAria}
        title={localeAria}
      >
        {nextLocale.toUpperCase()}
      </button>
    </div>
  );
}