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

Deno.test("post creates an external preview without an image", async () => {
  let request = 0;

  await withFetch((_input, init) => {
    request++;
    if (request === 1) return sessionResponse();

    const body = JSON.parse(String(init?.body));
    assertEquals(body.record.embed, {
      $type: "app.bsky.embed.external",
      external: {
        uri: "https://example.com/hello",
        title: "Hello",
        description: "Description",
      },
    });
    return createRecordResponse();
  }, async () => {
    const result = await post({
      identifier: "example.bsky.social",
      appPassword: "app-password",
      text: "Read https://example.com/hello",
      external: {
        uri: "https://example.com/hello",
        title: "Hello",
        description: "Description",
      },
    }).run(event, context);

    assertEquals(result.success, true);
    assertEquals(request, 2);
  });
});

Deno.test("post uploads an external preview image as a blob", async () => {
  let request = 0;
  const blob = {
    $type: "blob",
    ref: { $link: "bafkthumb" },
    mimeType: "image/png",
    size: 3,
  };

  await withFetch((input, init) => {
    request++;

    if (request === 1) return sessionResponse();

    if (request === 2) {
      assertEquals(String(input), "https://example.com/image.png");
      return Promise.resolve(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "image/png" },
        }),
      );
    }

    if (request === 3) {
      assertEquals(
        String(input),
        "https://bsky.social/xrpc/com.atproto.repo.uploadBlob",
      );
      const headers = new Headers(init?.headers);
      assertEquals(headers.get("authorization"), "Bearer access-token");
      assertEquals(headers.get("content-type"), "image/png");
      return Promise.resolve(Response.json({ blob }));
    }

    const body = JSON.parse(String(init?.body));
    assertEquals(body.record.embed.external.thumb, blob);
    return createRecordResponse();
  }, async () => {
    const result = await post({
      identifier: "example.bsky.social",
      appPassword: "app-password",
      text: "Hello",
      external: {
        uri: "https://example.com/hello",
        title: "Hello",
        description: "Description",
        image: "https://example.com/image.png",
      },
    }).run(event, context);

    assertEquals(result.success, true);
    assertEquals(request, 4);
  });
});

Deno.test("post degrades to an image-less preview when image fetching fails", async () => {
  let request = 0;

  await withFetch((_input, init) => {
    request++;

    if (request === 1) return sessionResponse();

    if (request === 2) {
      return Promise.resolve(new Response("missing", { status: 404 }));
    }

    const body = JSON.parse(String(init?.body));
    assertEquals(body.record.embed, {
      $type: "app.bsky.embed.external",
      external: {
        uri: "https://example.com/hello",
        title: "Hello",
        description: "Description",
      },
    });
    return createRecordResponse();
  }, async () => {
    const result = await post({
      identifier: "example.bsky.social",
      appPassword: "app-password",
      text: "Hello",
      external: {
        uri: "https://example.com/hello",
        title: "Hello",
        description: "Description",
        image: "https://example.com/missing.png",
      },
    }).run(event, context);

    assertEquals(result.success, true);
    assertEquals(request, 3);
  });
});

Deno.test("post degrades to an image-less preview when blob upload fails", async () => {
  let request = 0;

  await withFetch((_input, init) => {
    request++;

    if (request === 1) return sessionResponse();

    if (request === 2) {
      return Promise.resolve(
        new Response(new Uint8Array([1]), {
          headers: { "content-type": "image/png" },
        }),
      );
    }

    if (request === 3) {
      return Promise.resolve(new Response("too large", { status: 400 }));
    }

    const body = JSON.parse(String(init?.body));
    assertEquals(body.record.embed.external.thumb, undefined);
    return createRecordResponse();
  }, async () => {
    const result = await post({
      identifier: "example.bsky.social",
      appPassword: "app-password",
      text: "Hello",
      external: {
        uri: "https://example.com/hello",
        title: "Hello",
        description: "Description",
        image: "https://example.com/image.png",
      },
    }).run(event, context);

    assertEquals(result.success, true);
    assertEquals(request, 4);
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

Deno.test("post validates text length before fetching the preview image", async () => {
  let request = 0;

  await withFetch(() => {
    request++;
    return sessionResponse();
  }, async () => {
    const result = await post({
      identifier: "example.bsky.social",
      appPassword: "app-password",
      text: "a".repeat(301),
      external: {
        uri: "https://example.com/hello",
        title: "Hello",
        description: "Description",
        image: "https://example.com/image.png",
      },
    }).run(event, context);

    assertEquals(result.success, false);
    assertEquals(request, 1);
  });
});

Deno.test("post omits preview thumbnails with an oversized content length", async () => {
  let request = 0;

  await withFetch((_input, init) => {
    request++;

    if (request === 1) return sessionResponse();

    if (request === 2) {
      return Promise.resolve(
        new Response(new Uint8Array([1]), {
          headers: {
            "content-type": "image/png",
            "content-length": "1000001",
          },
        }),
      );
    }

    const body = JSON.parse(String(init?.body));
    assertEquals(body.record.embed.external.thumb, undefined);
    return createRecordResponse();
  }, async () => {
    const result = await post({
      identifier: "example.bsky.social",
      appPassword: "app-password",
      text: "Hello",
      external: {
        uri: "https://example.com/hello",
        title: "Hello",
        description: "Description",
        image: "https://example.com/image.png",
      },
    }).run(event, context);

    assertEquals(result.success, true);
    assertEquals(request, 3);
  });
});

Deno.test("post bounds preview image reads when content length is absent", async () => {
  let request = 0;

  await withFetch((_input, init) => {
    request++;

    if (request === 1) return sessionResponse();

    if (request === 2) {
      return Promise.resolve(
        new Response(new Uint8Array(1_000_001), {
          headers: { "content-type": "image/png" },
        }),
      );
    }

    const body = JSON.parse(String(init?.body));
    assertEquals(body.record.embed.external.thumb, undefined);
    return createRecordResponse();
  }, async () => {
    const result = await post({
      identifier: "example.bsky.social",
      appPassword: "app-password",
      text: "Hello",
      external: {
        uri: "https://example.com/hello",
        title: "Hello",
        description: "Description",
        image: "https://example.com/image.png",
      },
    }).run(event, context);

    assertEquals(result.success, true);
    assertEquals(request, 3);
  });
});

Deno.test("post ignores unsupported preview image protocols", async () => {
  let request = 0;

  await withFetch((_input, init) => {
    request++;

    if (request === 1) return sessionResponse();

    const body = JSON.parse(String(init?.body));
    assertEquals(body.record.embed.external.thumb, undefined);
    return createRecordResponse();
  }, async () => {
    const result = await post({
      identifier: "example.bsky.social",
      appPassword: "app-password",
      text: "Hello",
      external: {
        uri: "https://example.com/hello",
        title: "Hello",
        description: "Description",
        image: "file:///etc/passwd",
      },
    }).run(event, context);

    assertEquals(result.success, true);
    assertEquals(request, 2);
  });
});


Deno.test("post accepts a preview thumbnail at the one-megabyte boundary", async () => {
  let request = 0;
  const blob = {
    $type: "blob",
    ref: { $link: "bafkthumb" },
    mimeType: "image/png",
    size: 1_000_000,
  };

  await withFetch((_input, init) => {
    request++;

    if (request === 1) return sessionResponse();

    if (request === 2) {
      return Promise.resolve(
        new Response(new Uint8Array(1_000_000), {
          headers: {
            "content-type": "image/png",
            "content-length": "1000000",
          },
        }),
      );
    }

    if (request === 3) return Promise.resolve(Response.json({ blob }));

    const body = JSON.parse(String(init?.body));
    assertEquals(body.record.embed.external.thumb, blob);
    return createRecordResponse();
  }, async () => {
    const result = await post({
      identifier: "example.bsky.social",
      appPassword: "app-password",
      text: "Hello",
      external: {
        uri: "https://example.com/hello",
        title: "Hello",
        description: "Description",
        image: "https://example.com/image.png",
      },
    }).run(event, context);

    assertEquals(result.success, true);
    assertEquals(request, 4);
  });
});
