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

const longUrl = `https://example.com/${"x".repeat(100)}`;

Deno.test("post rejects text longer than 300 graphemes", async () => {
  let request = 0;

  await withFetch(() => {
    request++;
    return sessionResponse();
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

Deno.test("post validates length after shortening links", async () => {
  let request = 0;

  await withFetch((_input, init) => {
    request++;
    if (request === 1) return sessionResponse();

    const body = JSON.parse(String(init?.body));
    assertEquals(body.record.text.length, 300);
    return createRecordResponse();
  }, async () => {
    const sourceText = `${"a".repeat(269)} ${longUrl}`;
    assertEquals(sourceText.length > 300, true);

    const result = await post({
      identifier: "example.bsky.social",
      appPassword: "app-password",
      text: sourceText,
    }).run(event, context);

    assertEquals(result.success, true);
    assertEquals(request, 2);
  });
});

Deno.test("post rejects text still over the limit after shortening links", async () => {
  let request = 0;

  await withFetch(() => {
    request++;
    return sessionResponse();
  }, async () => {
    const result = await post({
      identifier: "example.bsky.social",
      appPassword: "app-password",
      text: `${"a".repeat(270)} ${longUrl}`,
    }).run(event, context);

    assertEquals(result.success, false);
    assertStringIncludes(result.message ?? "", "301 graphemes");
    assertEquals(request, 1);
  });
});

function sessionResponse(): Promise<Response> {
  return Promise.resolve(Response.json({
    did: "did:plc:example",
    accessJwt: "access-token",
  }));
}

function createRecordResponse(): Promise<Response> {
  return Promise.resolve(Response.json({
    uri: "at://did:plc:example/app.bsky.feed.post/abc",
    cid: "bafycid",
  }));
}

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
