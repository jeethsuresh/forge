import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { APP_DISPLAY_NAME } from "@/lib/app-name";
import { ThemeProvider } from "@/components/ThemeProvider";
import { THEME_STORAGE_KEY } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: APP_DISPLAY_NAME,
  description: "Local Docker deployment orchestrator",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

const themeBootScript = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)};var p=localStorage.getItem(k);var d=window.matchMedia("(prefers-color-scheme: dark)").matches;var t=p==="light"||p==="dark"?p:(d?"dark":"light");document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme="dark";}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="flex h-full min-h-0 flex-col">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
