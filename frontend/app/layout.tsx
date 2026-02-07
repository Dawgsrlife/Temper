import type { Metadata } from 'next';
import { Inter, Baloo_2 } from 'next/font/google';
import './globals.css';
import { clsx } from 'clsx';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const baloo = Baloo_2({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-baloo'
});

export const metadata: Metadata = {
  title: 'Temper - Trading Discipline Coach',
  description: 'Review your trading day like a chess game. Spot tilt, revenge trading, and improve your discipline.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={clsx(inter.variable, baloo.variable, "bg-[var(--color-temper-bg)] text-[var(--color-temper-text)] min-h-screen antialiased")}>
        {children}
      </body>
    </html>
  );
}
