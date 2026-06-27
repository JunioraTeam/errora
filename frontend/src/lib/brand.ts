/**
 * Brand name, configurable via env so the product can be white-labeled
 * (e.g. set NEXT_PUBLIC_BRAND_NAME="Erorra"). Falls back to "Errora".
 */
export const BRAND = process.env.NEXT_PUBLIC_BRAND_NAME?.trim() || "Errora";
