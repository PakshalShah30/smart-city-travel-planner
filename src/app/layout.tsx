import type { Metadata } from 'next';
import localFont from 'next/font/local';

import './globals.css';

/**
 * Fonts are self-hosted rather than fetched from Google Fonts at build time:
 * it removes a build-time network dependency, avoids a third-party request at
 * runtime, and keeps the build working behind restrictive network egress.
 * Both are variable fonts, subset to Latin, with unused axes pinned out.
 * Licences sit beside them in src/app/fonts (SIL Open Font License 1.1).
 */
const publicSans = localFont({
  src: './fonts/PublicSans-Variable.woff2',
  variable: '--font-sans',
  weight: '100 900',
  display: 'swap',
});

const fraunces = localFont({
  src: './fonts/Fraunces-Variable.woff2',
  variable: '--font-display',
  weight: '100 900',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Smart City Travel Planner',
    template: '%s · Smart City Travel Planner',
  },
  description:
    'Tell us your city, where you are starting and how long you have. We solve for the best route through real places, with real travel times, and get you back where you started.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`${publicSans.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
