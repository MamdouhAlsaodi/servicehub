import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { Inter, Fraunces, JetBrains_Mono } from 'next/font/google';
import { GlobalPreferencesMenu } from '@/components/GlobalPreferencesMenu';
import { AuthProvider } from '@/contexts/AuthContext';
import {
  PreferencesProvider,
  type Locale,
  type Theme,
} from '@/contexts/PreferencesContext';
import './globals.css';

const inter = Inter({ 
  subsets: ['latin', 'latin-ext'],
  variable: '--font-inter',
  display: 'swap',
});

const fraunces = Fraunces({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-fraunces',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'ServiceHub',
  description: 'منصة الخدمات المتميزة',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = cookies();
  const initialTheme: Theme = cookieStore.get('sh_theme')?.value === 'light' ? 'light' : 'dark';
  const initialLocale: Locale = cookieStore.get('sh_locale')?.value === 'en' ? 'en' : 'ar';
  const direction = initialLocale === 'ar' ? 'rtl' : 'ltr';

  return (
    <html lang={initialLocale} dir={direction} data-theme={initialTheme}>
      <body className={`${inter.variable} ${fraunces.variable} ${jetbrainsMono.variable}`}>
        <PreferencesProvider initialTheme={initialTheme} initialLocale={initialLocale}>
          <AuthProvider>{children}</AuthProvider>
          <GlobalPreferencesMenu />
        </PreferencesProvider>
      </body>
    </html>
  );
}
