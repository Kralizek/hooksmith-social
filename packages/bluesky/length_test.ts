import { assertEquals, assertStringIncludes } from "@std/assert";
import type { Context, Event } from "@hooksmith/core";
import { nullLoggerFactory } from "@hooksmith/runtime";
import { post } from "./mod.ts";

const event: Event = {
  type: "content.published",
  timestamp: Temporal.Instant.from("2026-09-14T07:18:38Z"),
  source: { kind: "website", id: "https://renatogolia.com" },
  data: {},
};

const context: Context = {
  logger: nullLoggerFactory,
};

Deno.test("post rejects text longer than 300 graphemes after link shortening", async () => {
  let request = 0;

  await withFetch(() => {
    request++;
    return Promise.resolve(Response.json({
      did: "did:plc:example",
      accessJwt: "access-token",
    }));
  }, async () => {
    const result = await post({
      identifier: "example.bsky.social",
      appPassword: "app-password",
      text: "a".repeat(301),
    }).run(event, context);

    assertEquals(result.success, false);
    assertStringIncludes(result.message ?? "", "301 graphemes");
    assertStringIncludes(result.message ?? "", "maximum is 300");
    assertEquals(request, 1);
  });
});

async function withFetch(
  implementation: typeof fetch,
  test: () => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = implementation;
  try {
    await test();
  } finally {
    globalThis.fetch = original;
  }
}
