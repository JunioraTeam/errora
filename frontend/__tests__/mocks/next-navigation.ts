// Test stub for `next/navigation` (not resolvable as a bare ESM subpath under
// vitest). Provides the hooks next-intl's navigation helpers consume.
export const useRouter = () => ({
  push: () => {},
  replace: () => {},
  prefetch: () => {},
  back: () => {},
  forward: () => {},
  refresh: () => {},
});
export const usePathname = () => "/";
export const useParams = () => ({ locale: "fa" });
export const useSearchParams = () => new URLSearchParams();
export const useSelectedLayoutSegment = () => null;
export const useSelectedLayoutSegments = () => [];
export const redirect = () => {};
export const permanentRedirect = () => {};
export const notFound = () => {};
export const RedirectType = { push: "push", replace: "replace" };
