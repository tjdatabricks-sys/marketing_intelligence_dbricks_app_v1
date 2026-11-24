import type { Metadata } from "next";
import "./globals.css";
import "./dashboard.css";
export const metadata: Metadata = {
  icons: { icon: "/logo.svg" },
  title: "Marketing Intelligence | Gold Analytics",
  description:
    "Databricks marketing intelligence, acquisition, contribution and source-data analytics",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
