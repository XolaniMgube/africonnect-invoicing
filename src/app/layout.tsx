import type { Metadata } from "next";
import { DataProvider } from "@/components/provider";
import "./globals.css";
export const metadata: Metadata = {
  title: "Africonnect Invoicing",
  description:
    "The Africonnect employee workspace for client-business quotations and invoices.",
  icons: { icon: "/africonnect-logo.png" },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-ZA">
      <body>
        <DataProvider>{children}</DataProvider>
      </body>
    </html>
  );
}
