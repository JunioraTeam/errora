import { Cpu } from "lucide-react";
import type { IconType } from "react-icons";
import { FaEdge, FaJava, FaWindows } from "react-icons/fa6";
import {
  SiAlpinelinux,
  SiAndroid,
  SiAngular,
  SiApple,
  SiArchlinux,
  SiBrave,
  SiDebian,
  SiDjango,
  SiDotnet,
  SiElixir,
  SiExpress,
  SiFastapi,
  SiFedora,
  SiFirefoxbrowser,
  SiFlask,
  SiGo,
  SiGooglechrome,
  SiIos,
  SiJavascript,
  SiLaravel,
  SiLinux,
  SiMacos,
  SiNextdotjs,
  SiNodedotjs,
  SiOpera,
  SiPhp,
  SiPython,
  SiReact,
  SiRuby,
  SiRubyonrails,
  SiRust,
  SiSafari,
  SiSpring,
  SiSymfony,
  SiTypescript,
  SiUbuntu,
  SiVuedotjs,
} from "react-icons/si";
import { cn } from "@/lib/utils";

// Map a free-text technology name (browser/OS/runtime/framework, possibly with a
// version) to its brand logo + colour. `color: undefined` means the brand mark is
// near-black, so it inherits the theme foreground to stay visible in dark mode.
// Order matters: more specific entries (frameworks) come before generic ones.
type Entry = { match: RegExp; Icon: IconType; color?: string };

const ENTRIES: Entry[] = [
  // Browsers
  { match: /chrome|chromium|crios/, Icon: SiGooglechrome, color: "#4285F4" },
  { match: /firefox|mozilla|gecko/, Icon: SiFirefoxbrowser, color: "#FF7139" },
  { match: /edge/, Icon: FaEdge, color: "#0078D7" },
  { match: /opera|opr/, Icon: SiOpera, color: "#FF1B2D" },
  { match: /brave/, Icon: SiBrave, color: "#FB542B" },
  { match: /safari/, Icon: SiSafari, color: "#0FB5EE" },
  // Frameworks (before their language so "php-laravel" → Laravel)
  { match: /laravel/, Icon: SiLaravel, color: "#FF2D20" },
  { match: /symfony/, Icon: SiSymfony },
  { match: /django/, Icon: SiDjango, color: "#0C4B33" },
  { match: /fastapi/, Icon: SiFastapi, color: "#009688" },
  { match: /flask/, Icon: SiFlask },
  { match: /rails|ruby ?on ?rails/, Icon: SiRubyonrails, color: "#CC0000" },
  { match: /next\.?js/, Icon: SiNextdotjs },
  { match: /express/, Icon: SiExpress },
  { match: /spring/, Icon: SiSpring, color: "#6DB33F" },
  { match: /angular/, Icon: SiAngular, color: "#DD0031" },
  { match: /vue/, Icon: SiVuedotjs, color: "#4FC08D" },
  { match: /react|react native/, Icon: SiReact, color: "#61DAFB" },
  // Operating systems
  { match: /android/, Icon: SiAndroid, color: "#3DDC84" },
  { match: /ios|iphone|ipad|ipod/, Icon: SiIos },
  { match: /mac ?os|macos|darwin|os x/, Icon: SiMacos },
  { match: /windows|win32|win64|winnt/, Icon: FaWindows, color: "#0078D6" },
  { match: /ubuntu/, Icon: SiUbuntu, color: "#E95420" },
  { match: /debian/, Icon: SiDebian, color: "#A81D33" },
  { match: /fedora/, Icon: SiFedora, color: "#51A2DA" },
  { match: /arch ?linux/, Icon: SiArchlinux, color: "#1793D1" },
  { match: /alpine/, Icon: SiAlpinelinux, color: "#0D597F" },
  { match: /linux/, Icon: SiLinux, color: "#FCC624" },
  { match: /apple/, Icon: SiApple },
  // Languages / runtimes
  { match: /node|nodejs/, Icon: SiNodedotjs, color: "#5FA04E" },
  { match: /\.net|dotnet|c#|csharp/, Icon: SiDotnet, color: "#512BD4" },
  { match: /php/, Icon: SiPhp, color: "#777BB4" },
  { match: /python|cpython/, Icon: SiPython, color: "#3776AB" },
  { match: /typescript/, Icon: SiTypescript, color: "#3178C6" },
  { match: /javascript|js\b/, Icon: SiJavascript, color: "#F7DF1E" },
  { match: /ruby/, Icon: SiRuby, color: "#CC342D" },
  { match: /golang|\bgo\b/, Icon: SiGo, color: "#00ADD8" },
  { match: /rust/, Icon: SiRust },
  { match: /elixir/, Icon: SiElixir, color: "#4B275F" },
  { match: /java/, Icon: FaJava, color: "#EA2D2E" },
];

function lookup(name: string | null | undefined): Entry | undefined {
  if (!name) return undefined;
  const n = name.toLowerCase();
  return ENTRIES.find((e) => e.match.test(n));
}

/** Whether a brand logo is known for this technology name. */
export function hasTechIcon(name: string | null | undefined): boolean {
  return !!lookup(name);
}

/**
 * Brand logo for a technology (browser, OS, language, framework). Falls back to
 * a neutral chip icon when the name is unknown.
 */
export function TechIcon({ name, className }: { name?: string | null; className?: string }) {
  const entry = lookup(name);
  if (!entry) {
    return <Cpu aria-hidden className={cn("text-muted-foreground", className)} />;
  }
  const { Icon, color } = entry;
  return (
    <Icon
      aria-hidden
      title={name ?? undefined}
      className={className}
      style={color ? { color } : undefined}
    />
  );
}
