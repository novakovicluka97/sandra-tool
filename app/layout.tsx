import type { Metadata } from "next";
import { Archivo, Source_Serif_4 } from "next/font/google";
import "./globals.css";

const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-grotesk",
});

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-serif",
});

export const metadata: Metadata = {
  title: "Zeugnis-Generator | Reference Generator · Polymed",
  description:
    "Creates HR-reviewed Swiss employment reference drafts from locally protected request forms.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de-CH">
      <body className={`${archivo.variable} ${sourceSerif.variable}`}>
        {children}
      </body>
    </html>
  );
}
