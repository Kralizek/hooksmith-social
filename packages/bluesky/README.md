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

`post` creates a short-lived Bluesky session for the invocation and writes an
`app.bsky.feed.post` record. The listener returns the created record URI and
CID.

`service` defaults to `https://bsky.social` and can be overridden for accounts
hosted on another PDS. `languages` and `createdAt` are optional; values may be
static or event/context-derived factories.

## External previews

Provide preview metadata explicitly with `external`. Hooksmith serializes it as
an `app.bsky.embed.external` embed; it does not fetch or parse page metadata.

```ts
post({
  identifier: "example.bsky.social",
  appPassword: Deno.env.get("BLUESKY_APP_PASSWORD")!,
  text: (event) => event.data.title,
  external: (event) => ({
    uri: event.metadata!.url!,
    title: event.data.title,
    description: event.data.description,
    image: event.data.image,
  }),
});
```

When `image` is provided, the image is downloaded and uploaded to the account's
PDS as a blob. Only HTTP(S) image URLs with image content are accepted, and callers should treat
the URL as trusted input. Images larger than Bluesky's 1 MB limit are skipped.
Image download or upload failures degrade to a preview without a thumbnail
rather than preventing the text post from being published.
