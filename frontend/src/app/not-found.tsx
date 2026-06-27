import { Vazirmatn } from "next/font/google";
import Link from "next/link";

// Top-level not-found for requests that fall outside the [locale] segment.
// It must render its own <html>/<body> because the root layout does not — so it
// also loads Vazirmatn itself (the locale layout's font doesn't reach here).
const vazirmatn = Vazirmatn({ subsets: ["arabic", "latin"], display: "swap" });

export default function GlobalNotFound() {
  return (
    <html lang="fa" dir="rtl" className={vazirmatn.className}>
      <body
        style={{
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          fontFamily: vazirmatn.style.fontFamily,
          background: "#1a1a18",
          color: "#f5f4ef",
        }}
      >
        <h1 style={{ fontSize: "2rem", fontWeight: 700 }}>404</h1>
        <p>صفحه پیدا نشد — Page not found</p>
        <Link href="/fa" style={{ color: "#da7756" }}>
          بازگشت به خانه
        </Link>
      </body>
    </html>
  );
}
