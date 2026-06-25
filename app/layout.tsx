import './globals.css';

import type { Metadata } from 'next';
import { ReactNode } from 'react';

import { GlobalTableSorter } from '@/app/_components/global-table-sorter';
import { themeInitScript } from '@/app/_components/ui/theme';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'CO-OP Operations & Intelligence',
  description:
    'Operations & Intelligence dashboard for the RRHS Co-Op — scheduling, attendance, inventory, finance, and executive analytics.'
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body suppressHydrationWarning>
        <Providers>
          <GlobalTableSorter />
          {children}
        </Providers>
      </body>
    </html>
  );
}
