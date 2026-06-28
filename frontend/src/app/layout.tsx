import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "TipTip — Conditional Tipping & Verification Escrow",
  description: "A premium decentralized escrow tipping system powered by GenLayer's AI consensus. Tip creators under custom criteria, resolved by independent validator reviews.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700;800&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body style={{ margin: 0, padding: 0, backgroundColor: "#09090b", color: "#f4f4f5" }}>
        {children}
      </body>
    </html>
  );
}
