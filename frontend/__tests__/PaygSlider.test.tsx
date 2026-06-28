import { fireEvent, screen } from "@testing-library/react";
import type * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { PAYG, paygCost } from "@/lib/pricing";
import { formatToman } from "@/lib/utils";
import { renderWithIntl } from "./test-utils";

// The slider links to /register via the i18n Link; stub it to a plain anchor.
vi.mock("@/i18n/routing", async () => {
  const actual = await vi.importActual<typeof import("@/i18n/routing")>("@/i18n/routing");
  return {
    ...actual,
    Link: ({ children, ...props }: React.PropsWithChildren<{ href: string }>) => (
      <a {...props}>{children}</a>
    ),
  };
});

import { PaygSlider } from "@/components/marketing/PaygSlider";

describe("PaygSlider", () => {
  it("renders the default estimated Toman cost (fa)", () => {
    renderWithIntl(<PaygSlider />, { locale: "fa" });
    const expected = formatToman(paygCost(PAYG.defaultEvents), "fa");
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("updates the estimate when the slider moves", () => {
    renderWithIntl(<PaygSlider />, { locale: "en" });
    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "1000000" } });
    const expected = formatToman(paygCost(1_000_000), "en");
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("matches the pure paygCost calculation at the free threshold", () => {
    expect(paygCost(PAYG.freeEvents)).toBe(0);
  });
});
