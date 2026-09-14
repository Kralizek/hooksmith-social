import { assertEquals } from "@std/assert";
import type { Context, Event } from "@hooksmith/core";
import { nullLoggerFactory } from "@hooksmith/runtime";
import { post } from "./mod.ts";

const event: Event = {
  type: "content.published",
  timestamp: Temporal.Instant.from("2026-09-14T07:18:38Z"),
  source: { kind: "website", id: "https://renatogolia.com" },
  metadata: {
    url:
      "https://renatogolia.com/2026/09/14/scenario-focused-unit-tests-autofixture/",
  },
  data: {},
};

const context: Context = {
  logger: nullLoggerFactory,
};

Deno.test("post shortens displayed links while preserving the target URI", async () => {
  let request = 0;

  await withFetch((_input, init) => {
    request++;

    if (request === 1) {
      return Promise.resolve(Response.json({
        did: "did:plc:example",
        accessJwt: "access-token",
      }));
    }

    const body = JSON.parse(String(init?.body));
    assertEquals(
      body.record.text,
      "Read renatogolia.com/2026/09/14/sc…",
    );
    assertEquals(body.record.facets, [{
      index: { byteStart: 5, byteEnd: 37 },
      features: [{
        $type: "app.bsky.richtext.facet#link",
        uri:
          "https://renatogolia.com/2026/09/14/scenario-focused-unit-tests-autofixture/",
      }],
    }]);

    return Promise.resolve(Response.json({
      uri: "at://did:plc:example/app.bsky.feed.post/abc",
      cid: "bafycid",
    }));
  }, async () => {
    const result = await post({
      identifier: "example.bsky.social",
      appPassword: "app-password",
      text: (current) => `Read ${current.metadata?.url}`,
    }).run(event, context);

    assertEquals(result.success, true);
    assertEquals(request, 2);
  });
});

Deno.test("post normalizes short links to display form", async () => {
  let request = 0;

  await withFetch((_input, init) => {
    request++;

    if (request === 1) {
      return Promise.resolve(Response.json({
        did: "did:plc:example",
        accessJwt: "access-token",
      }));
    }

    const body = JSON.parse(String(init?.body));
    assertEquals(body.record.text, "Read example.com/a");
    assertEquals(body.record.facets, [{
      index: { byteStart: 5, byteEnd: 18 },
      features: [{
        $type: "app.bsky.richtext.facet#link",
        uri: "https://example.com/a",
      }],
    }]);

    return Promise.resolve(Response.json({
      uri: "at://did:plc:example/app.bsky.feed.post/abc",
      cid: "bafycid",
    }));
  }, async () => {
    const result = await post({
      identifier: "example.bsky.social",
      appPassword: "app-password",
      text: "Read https://example.com/a",
    }).run(event, context);

    assertEquals(result.success, true);
    assertEquals(request, 2);
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
