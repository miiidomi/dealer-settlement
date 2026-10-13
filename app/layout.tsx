import type { Metadata } from "next";
import "./globals.css";
import { SessionGuard } from "./session-guard";

export const metadata: Metadata = {
  title: "딜러 정산 관리",
  description: "가맹점별 설치 원가와 월 수익을 기준으로 딜러 정산액을 계산합니다.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased"><SessionGuard>{children}</SessionGuard></body>
    </html>
  );
}
