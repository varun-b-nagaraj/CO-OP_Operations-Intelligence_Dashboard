import './globals.css';

import type { Metadata } from 'next';
import { ReactNode } from 'react';

import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'CO-OP Operations Dashboard',
  description: 'HR module for CO-OP Operations & Intelligence Portal'
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
