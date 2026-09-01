# @hooksmith/mastodon

Mastodon publishing listeners for Hooksmith.

```ts
import { postStatus } from "@hooksmith/mastodon";

const listener = postStatus({
  instance: "https://mastodon.social",
  accessToken: Deno.env.get("MASTODON_ACCESS_TOKEN")!,
  status: (event) => `Published: ${event.metadata?.url}`,
});
```

`postStatus` uses Mastodon's `POST /api/v1/statuses` endpoint and returns a
compact report containing the created status ID, URL, URI, and creation time.

Optional values include `visibility`, `language`, `spoilerText`, `sensitive`,
and `idempotencyKey`. Static values and event/context-derived factories are
supported.
