import type { Metadata } from 'next';
import { DM_Sans, Instrument_Serif } from 'next/font/google';
import './globals.css';

const sans = DM_Sans({ variable: '--font-sans', subsets: ['latin'] });
const serif = Instrument_Serif({ variable: '--font-serif', subsets: ['latin'], weight: '400' });

export const metadata: Metadata = {
  title: 'Down Town Ramen — Reserve your seat',
  description: 'Book a seat for a small-batch private ramen lunch.',
  openGraph: {
    title: 'Down Town Ramen — Reserve your seat',
    description: 'Small-batch ramen. Choose a time and reserve your seat.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Down Town Ramen — A seat at the ramen bar' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Down Town Ramen — Reserve your seat',
    description: 'Small-batch ramen. Choose a time and reserve your seat.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${sans.variable} ${serif.variable}`}>{children}</body></html>;
}
