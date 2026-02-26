import type { Metadata } from "next";
import "./globals.css";

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
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
