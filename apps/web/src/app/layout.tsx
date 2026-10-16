import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { Providers } from "@/components/app/Providers";
import "@/styles/globals.css";

const jakarta = localFont({
  src: "../fonts/plus-jakarta-sans-latin-wght-normal.woff2",
  weight: "200 800",
  variable: "--font-jakarta",
  display: "swap",
});

const atkinson = localFont({
  src: [
    { path: "../fonts/atkinson-hyperlegible-next-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../fonts/atkinson-hyperlegible-next-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-atkinson",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "MedCuidar", template: "%s · MedCuidar" },
  description: "Remédios dos idosos da família: lembretes, estoque, receitas e reposição.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F3F6FC" },
    { media: "(prefers-color-scheme: dark)", color: "#0B1222" },
  ],
};

/** Aplica o tema antes da pintura (evita piscar). Guardado em try/catch: storage pode estar bloqueado. */
const themeScript = `try{var t=localStorage.getItem('mc-theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.setAttribute('data-theme','dark');}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={`${jakarta.variable} ${atkinson.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
