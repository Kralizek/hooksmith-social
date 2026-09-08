import { assertEquals } from "@std/assert";
import type { Context, Event } from "@hooksmith/core";
import { nullLoggerFactory } from "@hooksmith/runtime";
import { post } from "./mod.ts";

const event: Event = {
  type: "page.published",
  timestamp: Temporal.Instant.from("2026-09-01T10:00:00Z"),
  source: { kind: "website", id: "example.com" },
  metadata: { url: "https://example.com/hello" },
  data: { title: "Hello" },
};

const context: Context = {
  logger: nullLoggerFactory,
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
        text: "Published ✍️ https://example.com/hello",
        createdAt: "2026-09-01T12:00:00.000Z",
        langs: ["en"],
        facets: [{
          index: { byteStart: 17, byteEnd: 42 },
          features: [{
            $type: "app.bsky.richtext.facet#link",
            uri: "https://example.com/hello",
          }],
        }],
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
      text: (current) => `Published ✍️ ${current.metadata?.url}`,
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

Deno.test("post detects uppercase HTTP schemes", async () => {
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
    assertEquals(body.record.facets, [{
      index: { byteStart: 6, byteEnd: 31 },
      features: [{
        $type: "app.bsky.richtext.facet#link",
        uri: "HTTPS://example.com/hello",
      }],
    }]);
    return Promise.resolve(Response.json({
      uri: "at://did:plc:example/app.bsky.feed.post/abc",
      cid: "bafycid",
    }));
  }, async () => {
    await post({
      identifier: "example.bsky.social",
      appPassword: "app-password",
      text: "Read: HTTPS://example.com/hello",
    }).run(event, context);
  });
});

Deno.test("post trims trailing punctuation from link facets", async () => {
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
    assertEquals(body.record.facets, [{
      index: { byteStart: 6, byteEnd: 31 },
      features: [{
        $type: "app.bsky.richtext.facet#link",
        uri: "https://example.com/hello",
      }],
    }]);
    return Promise.resolve(Response.json({
      uri: "at://did:plc:example/app.bsky.feed.post/abc",
      cid: "bafycid",
    }));
  }, async () => {
    await post({
      identifier: "example.bsky.social",
      appPassword: "app-password",
      text: "Read: https://example.com/hello.",
    }).run(event, context);
  });
});

Deno.test("post creates hashtag facets with UTF-8 byte offsets", async () => {
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
    assertEquals(body.record.facets, [
      {
        index: { byteStart: 9, byteEnd: 16 },
        features: [{
          $type: "app.bsky.richtext.facet#tag",
          tag: "dotnet",
        }],
      },
      {
        index: { byteStart: 17, byteEnd: 25 },
        features: [{
          $type: "app.bsky.richtext.facet#tag",
          tag: "svenska",
        }],
      },
    ]);
    return Promise.resolve(Response.json({
      uri: "at://did:plc:example/app.bsky.feed.post/abc",
      cid: "bafycid",
    }));
  }, async () => {
    await post({
      identifier: "example.bsky.social",
      appPassword: "app-password",
      text: "Hej 👋 #dotnet #svenska",
    }).run(event, context);
  });
});

Deno.test("post does not create hashtag facets inside links", async () => {
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
    assertEquals(body.record.facets, [
      {
        index: { byteStart: 4, byteEnd: 31 },
        features: [{
          $type: "app.bsky.richtext.facet#link",
          uri: "https://example.com/#dotnet",
        }],
      },
      {
        index: { byteStart: 32, byteEnd: 37 },
        features: [{
          $type: "app.bsky.richtext.facet#tag",
          tag: "deno",
        }],
      },
    ]);
    return Promise.resolve(Response.json({
      uri: "at://did:plc:example/app.bsky.feed.post/abc",
      cid: "bafycid",
    }));
  }, async () => {
    await post({
      identifier: "example.bsky.social",
      appPassword: "app-password",
      text: "See https://example.com/#dotnet #deno",
    }).run(event, context);
  });
});

Deno.test("post omits facets when the text has no rich text", async () => {
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
    assertEquals(body.record.facets, undefined);
    return Promise.resolve(Response.json({
      uri: "at://did:plc:example/app.bsky.feed.post/abc",
      cid: "bafycid",
    }));
  }, async () => {
    await post({
      identifier: "example.bsky.social",
      appPassword: "app-password",
      text: "Hello Bluesky",
    }).run(event, context);
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
