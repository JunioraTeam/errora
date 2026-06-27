import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Logo, LogoMark } from "@/components/Logo";

describe("Logo", () => {
  it("renders the wordmark with the brand name", () => {
    const { container } = render(<Logo />);
    const spanWithText = Array.from(container.querySelectorAll("span")).find(
      (el) => el.textContent === "Errora" && el.querySelector("svg") === null,
    );
    expect(spanWithText).toBeDefined();
  });

  it("renders an accessible SVG mark", () => {
    render(<LogoMark title="Errora" />);
    const svg = screen.getByRole("img", { name: "Errora" });
    expect(svg).toBeInTheDocument();
    expect(svg.tagName.toLowerCase()).toBe("svg");
  });

  it("hides the wordmark span when showText is false", () => {
    const { container } = render(<Logo showText={false} />);
    // The text wordmark is a <span>; the SVG <title> is not rendered as a span.
    const spanWithText = Array.from(container.querySelectorAll("span")).find(
      (el) => el.textContent === "Errora" && el.querySelector("svg") === null,
    );
    expect(spanWithText).toBeUndefined();
  });
});
