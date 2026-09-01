# @hooksmith/bluesky

Bluesky publishing listeners for Hooksmith.

```ts
import { post } from "@hooksmith/bluesky";

const listener = post({
  identifier: "example.bsky.social",
  appPassword: Deno.env.get("BLUESKY_APP_PASSWORD")!,
  text: (event) => `Published: ${event.metadata?.url}`,
});
```

`post` creates a short-lived Bluesky session for the invocation and writes an `app.bsky.feed.post` record. The listener returns the created record URI and CID.

`service` defaults to `https://bsky.social` and can be overridden for accounts hosted on another PDS. `languages` and `createdAt` are optional; values may be static or event/context-derived factories.
