import { assertEquals } from "@std/assert";
import type { Context, Event } from "@hooksmith/core";
import { postStatus } from "./mod.ts";

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

Deno.test("postStatus publishes a Mastodon status", async () => {
  await withFetch((_input, init) => {
    assertEquals(String(_input), "https://social.example/api/v1/statuses");
    const requestHeaders = new Headers(init?.headers);
    assertEquals(requestHeaders.get("authorization"), "Bearer secret");
    assertEquals(requestHeaders.get("idempotency-key"), "page.published");
    assertEquals(
      init?.body,
      "status=Published%3A+https%3A%2F%2Fexample.com%2Fhello&visibility=public",
    );

    return Promise.resolve(Response.json({
      id: "123",
      url: "https://social.example/@user/123",
      uri: "https://social.example/users/user/statuses/123",
      created_at: "2026-09-01T12:00:00.000Z",
    }));
  }, async () => {
    const result = await postStatus({
      instance: "https://social.example/",
      accessToken: "secret",
      status: (current) => `Published: ${current.metadata?.url}`,
      visibility: "public",
      idempotencyKey: (current) => current.type,
    }).run(event, context);

    assertEquals(result.success, true);
    assertEquals(result.data, {
      id: "123",
      url: "https://social.example/@user/123",
      uri: "https://social.example/users/user/statuses/123",
      createdAt: "2026-09-01T12:00:00.000Z",
    });
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
