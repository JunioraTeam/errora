import type { Tokens } from "./types";

const ACCESS_KEY = "errora.access";
const REFRESH_KEY = "errora.refresh";

const isBrowser = typeof window !== "undefined";

export const tokenStore = {
  get(): Tokens | null {
    if (!isBrowser) return null;
    const access = window.localStorage.getItem(ACCESS_KEY);
    const refresh = window.localStorage.getItem(REFRESH_KEY);
    if (!access || !refresh) return null;
    return { access, refresh };
  },
  set(tokens: Tokens) {
    if (!isBrowser) return;
    window.localStorage.setItem(ACCESS_KEY, tokens.access);
    window.localStorage.setItem(REFRESH_KEY, tokens.refresh);
  },
  clear() {
    if (!isBrowser) return;
    window.localStorage.removeItem(ACCESS_KEY);
    window.localStorage.removeItem(REFRESH_KEY);
  },
};
