import { assertEquals } from "@std/assert";
import type { Context, Event } from "@hooksmith/core";
import { post } from "./mod.ts";

const event: Event = {
  type: "page.published",
  timestamp: Temporal.Instant.from("2026-09-01T10:00:00Z"),
  source: { kind: "website", id: "example.com" },
  metadata: { url: "https://example.com/hello" },
  data: { title: "Hello" },
};

const context: Context = {
  log: { debug() {}, info() {}, warn() {}, error() {} },
};

Deno.test("post authenticates and creates a Bluesky post", async () => {
  let request = 0;

  await withFetch((input, init) => {
    request++;

    if (request === 1) {
      assertEquals(
        String(input),
        "https://bsky.social/xrpc/com.atproto.server.createSession",
      );
      assertEquals(
        JSON.parse(String(init?.body)),
        { identifier: "example.bsky.social", password: "app-password" },
      );
      return Promise.resolve(Response.json({
        did: "did:plc:example",
        accessJwt: "access-token",
        refreshJwt: "refresh-token",
      }));
    }

    assertEquals(
      String(input),
      "https://bsky.social/xrpc/com.atproto.repo.createRecord",
    );
    assertEquals(
      new Headers(init?.headers).get("authorization"),
      "Bearer access-token",
    );
    assertEquals(JSON.parse(String(init?.body)), {
      repo: "did:plc:example",
      collection: "app.bsky.feed.post",
      record: {
        $type: "app.bsky.feed.post",
        text: "Published: https://example.com/hello",
        createdAt: "2026-09-01T12:00:00.000Z",
        langs: ["en"],
      },
    });
    return Promise.resolve(Response.json({
      uri: "at://did:plc:example/app.bsky.feed.post/abc",
      cid: "bafycid",
    }));
  }, async () => {
    const result = await post({
      identifier: "example.bsky.social",
      appPassword: "app-password",
      text: (current) => `Published: ${current.metadata?.url}`,
      createdAt: "2026-09-01T12:00:00.000Z",
      languages: ["en"],
    }).run(event, context);

    assertEquals(result.success, true);
    assertEquals(result.data, {
      uri: "at://did:plc:example/app.bsky.feed.post/abc",
      cid: "bafycid",
    });
    assertEquals(request, 2);
  });
});

Deno.test("post stops when Bluesky authentication fails", async () => {
  let request = 0;
  await withFetch(() => {
    request++;
    return Promise.resolve(Response.json(
      { error: "AuthenticationRequired", message: "Bad credentials" },
      { status: 401 },
    ));
  }, async () => {
    const result = await post({
      identifier: "example.bsky.social",
      appPassword: "wrong",
      text: "Hello",
    }).run(event, context);

    assertEquals(result.success, false);
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
