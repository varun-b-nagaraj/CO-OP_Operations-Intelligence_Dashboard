import './globals.css';

import type { Metadata } from 'next';
import { ReactNode } from 'react';

import { GlobalTableSorter } from '@/app/_components/global-table-sorter';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'CO-OP Operations Dashboard',
  description: 'HR module for CO-OP Operations & Intelligence Portal'
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        <Providers>
          <GlobalTableSorter />
          {children}
        </Providers>
      </body>
    </html>
  );
}
