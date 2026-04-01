import type { Metadata } from "next";
import Script from "next/script";
import { JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";

const appSans = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-app-sans",
  display: "swap",
});

const appMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-app-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Drink Cost Calculator",
  description: "Gestao de custos, receitas e cardapio de drinks",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <head>
        {process.env.NODE_ENV === "development" && (
          <Script
            src="//unpkg.com/react-grab/dist/index.global.js"
            crossOrigin="anonymous"
            strategy="beforeInteractive"
          />
        )}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20,500,0,0"
        />
      </head>
      <body className={`${appSans.variable} ${appMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
