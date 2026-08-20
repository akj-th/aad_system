import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import MapHost from "@/components/MapHost";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AAD System",
  description: "건축 설계 토탈 시스템",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const apiKey = process.env.VWORLD_API_KEY;
  // 브이월드 초기화 스크립트는 내부에서 document.write로 하위 스크립트를 로드하므로
  // next/script(비동기)가 아니라 파서 블로킹 <script>로 로드해야 한다.
  // 지도용 인증키는 URL에 포함되는 구조라 클라이언트 노출이 불가피하며, 도메인 등록으로 보호된다.
  const scriptSrc = apiKey
    ? `https://map.vworld.kr/js/webglMapInit.js.do?version=3.0&apiKey=${encodeURIComponent(apiKey)}`
    : null;

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {scriptSrc ? (
          // eslint-disable-next-line @next/next/no-sync-scripts -- document.write 기반 로더라 동기 로드 필수
          <script src={scriptSrc} />
        ) : null}
        {/* 지도 싱글턴 — 라우트가 바뀌어도 언마운트되지 않는다 */}
        <MapHost />
        {children}
      </body>
    </html>
  );
}
