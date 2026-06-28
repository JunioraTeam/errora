import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "./test-utils";

const replace = vi.fn();

// Mock the i18n navigation helpers used by LocaleSwitcher.
vi.mock("@/i18n/routing", async () => {
  const actual = await vi.importActual<typeof import("@/i18n/routing")>("@/i18n/routing");
  return {
    ...actual,
    usePathname: () => "/dashboard",
    useRouter: () => ({ replace, push: vi.fn() }),
  };
});

import { LocaleSwitcher } from "@/components/ui/LocaleSwitcher";

describe("LocaleSwitcher", () => {
  beforeEach(() => {
    replace.mockClear();
  });

  it("shows the other locale label (English while in fa)", () => {
    renderWithIntl(<LocaleSwitcher />, { locale: "fa" });
    const btn = screen.getByTestId("locale-switcher");
    expect(btn).toHaveAttribute("data-current", "fa");
    expect(btn).toHaveTextContent("English");
  });

  it("toggles to the other locale when clicked", () => {
    renderWithIntl(<LocaleSwitcher />, { locale: "fa" });
    fireEvent.click(screen.getByTestId("locale-switcher"));
    expect(replace).toHaveBeenCalledWith("/dashboard", { locale: "en" });
  });

  it("offers Persian while in en", () => {
    renderWithIntl(<LocaleSwitcher />, { locale: "en" });
    const btn = screen.getByTestId("locale-switcher");
    expect(btn).toHaveAttribute("data-current", "en");
    expect(btn).toHaveTextContent("فارسی");
  });
});
