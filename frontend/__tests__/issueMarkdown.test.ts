import { describe, expect, it } from "vitest";
import { issueToMarkdown } from "@/lib/issueMarkdown";
import type { IssueDetail } from "@/lib/types";

function fixture(): IssueDetail {
  return {
    id: "1",
    title: "Exception: Gateway -112",
    type: "Exception",
    value: "Gateway -112",
    culprit: "App\\Services\\Pay::pay",
    level: "error",
    status: "unresolved",
    priority: "high",
    times_seen: 1234,
    first_seen: "2026-06-20T10:00:00Z",
    last_seen: "2026-06-25T10:00:00Z",
    assignees: [],
    autofix_state: "idle",
    repository: null,
    latest_event: {
      event_id: "abc123",
      data: {
        event_id: "abc123",
        environment: "production",
        release: "app@1.2.3",
        platform: "php",
        transaction: "/purchase/{id}/recover",
        exception: {
          values: [
            {
              type: "Exception",
              value: "Gateway -112",
              mechanism: { type: "generic", handled: false },
              stacktrace: {
                frames: [
                  { filename: "/app/Kernel.php", function: "handle", in_app: false, lineno: 10 },
                  {
                    filename: "/app/Services/Pay.php",
                    function: "pay",
                    in_app: true,
                    lineno: 47,
                    context_line: "    throw new Exception('boom');",
                  },
                ],
              },
            },
          ],
        },
        request: { url: "https://juniora.org/purchase/164288/recover", method: "GET" },
        breadcrumbs: [
          {
            category: "db.sql.query",
            message: "select * from `t` where id = ?",
            data: { executionTimeMs: 1.17 },
          },
          { category: "cache", message: "Missed: key" },
        ],
        tags: {
          runtime: "php 8.5.7",
          url: "https://juniora.org/x",
          os: "Linux",
          custom: "drop-me",
        },
      },
    },
  };
}

describe("issueToMarkdown", () => {
  const md = issueToMarkdown(fixture());

  it("starts with the title heading", () => {
    expect(md.startsWith("# Exception: Gateway -112")).toBe(true);
  });

  it("includes core metadata", () => {
    expect(md).toContain("- **Level:** error");
    expect(md).toContain("- **Priority:** high");
    expect(md).toContain("- **Mechanism:** generic (unhandled)");
    expect(md).toContain("- **Event ID:** abc123");
  });

  it("includes the HTTP request and stack (in-app frame first, with context)", () => {
    expect(md).toContain("## HTTP request");
    expect(md).toContain("GET https://juniora.org/purchase/164288/recover");
    expect(md).toContain("/app/Services/Pay.php:47 in pay");
    expect(md).toContain("throw new Exception('boom');");
  });

  it("includes breadcrumbs with SQL timing", () => {
    expect(md).toContain("- [db.sql.query] select * from `t` where id = ? (1.17ms)");
  });

  it("keeps only allow-listed tags (drops noise)", () => {
    expect(md).toContain("- runtime: php 8.5.7");
    expect(md).not.toContain("drop-me");
  });
});
