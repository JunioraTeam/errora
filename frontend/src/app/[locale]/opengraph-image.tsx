import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { getTranslations } from "next-intl/server";
import { BRAND } from "@/lib/brand";

// Branded social-share card, generated for every page under [locale] (Next's
// opengraph-image file convention auto-attaches it to OpenGraph + Twitter meta).
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = BRAND;

// Vazirmatn covers both Latin and Persian/Arabic glyphs — satori needs the raw
// font bytes (the default font can't render Persian, hence the "tofu" boxes).
// Bundled under public/ so rendering never depends on a runtime CDN fetch.
async function loadFont(file: string): Promise<ArrayBuffer> {
  const buf = await readFile(join(process.cwd(), "public", "fonts", file));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

export default async function OpengraphImage() {
  // The share card is always rendered in English (LTR), regardless of locale.
  const t = await getTranslations({ locale: "en", namespace: "common" });
  const accent = "#da7756";
  const isRtl = false;

  const [regular, bold] = await Promise.all([
    loadFont("Vazirmatn-Regular.ttf"),
    loadFont("Vazirmatn-Bold.ttf"),
  ]);

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "100px",
        background: "#1a1714",
        backgroundImage: `radial-gradient(900px 500px at 85% 15%, ${accent}33, transparent)`,
        color: "#f5f0eb",
        fontFamily: "Vazirmatn",
        direction: isRtl ? "rtl" : "ltr",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
        {/* Warning-triangle brand mark */}
        {/* biome-ignore lint/a11y/noSvgWithoutTitle: rendered to a raster OG image by satori, not interactive DOM */}
        <svg width="92" height="92" viewBox="0 0 32 32" fill="none">
          <path
            d="M16 3.5c1.05 0 2.02.55 2.56 1.45l11.1 18.86A3 3 0 0 1 27.1 28.3H4.9a3 3 0 0 1-2.56-4.49L13.44 4.95A3 3 0 0 1 16 3.5Z"
            stroke="#f5f0eb"
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          <rect x="14.4" y="11" width="3.2" height="7.4" rx="1.6" fill="#f5f0eb" />
          <circle cx="16" cy="22.4" r="1.9" fill={accent} />
        </svg>
        <span style={{ fontSize: 84, fontWeight: 700, letterSpacing: isRtl ? 0 : -2 }}>
          {BRAND}
        </span>
      </div>
      <div style={{ marginTop: 36, fontSize: 44, color: "#c8bdb2", maxWidth: 1000 }}>
        {t("tagline")}
      </div>
      <div style={{ marginTop: 64, height: 8, width: 200, borderRadius: 4, background: accent }} />
    </div>,
    {
      ...size,
      fonts: [
        { name: "Vazirmatn", data: regular, weight: 400, style: "normal" },
        { name: "Vazirmatn", data: bold, weight: 700, style: "normal" },
      ],
    }
  );
}
