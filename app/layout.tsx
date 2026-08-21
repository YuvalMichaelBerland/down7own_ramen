import type { Metadata } from 'next';
import { Frank_Ruhl_Libre, Noto_Sans_Hebrew } from 'next/font/google';
import './globals.css';

const sans = Noto_Sans_Hebrew({ variable: '--font-sans', subsets: ['hebrew'], weight: ['400','600','700'] });
const serif = Frank_Ruhl_Libre({ variable: '--font-serif', subsets: ['hebrew'], weight: ['400','600'] });

export const metadata: Metadata = {
  title: 'דאון טאון ראמן — הזמנת מקום',
  description: 'הזמינו מקום לארוחת ראמן פרטית במהדורה קטנה.',
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
  return <html lang="he" dir="rtl"><body className={`${sans.variable} ${serif.variable}`}>{children}</body></html>;
}
