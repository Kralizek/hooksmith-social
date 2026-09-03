# hooksmith-social

Social publishing extensions for [Hooksmith](https://github.com/Kralizek/hooksmith).

These packages expose Hooksmith listeners for publishing to social platforms. They are deliberately listener-oriented rather than general-purpose platform SDKs, and they build on `@hooksmith/http` for transport and response handling.

## Packages

| Package | Purpose |
| --- | --- |
| [`@hooksmith/bluesky`](https://jsr.io/@hooksmith/bluesky) | Publish posts to Bluesky using an account identifier and app password. |
| [`@hooksmith/mastodon`](https://jsr.io/@hooksmith/mastodon) | Publish statuses to Mastodon-compatible instances using a user access token. |

Both packages return ordinary Hooksmith `Listener` instances. They can be attached directly to routes, used as terminal listeners in `@hooksmith/pipeline`, or wrapped with `tap(listener)` when publishing should happen without changing the value flowing through the rest of the pipeline.

For example:

```ts
pipe(
  project(toSocialPost),
  tap(bluesky),
  project(toAuditRecord),
  audit,
);
```

## Examples

- [`examples/bluesky`](examples/bluesky) shows `post(...)` using `BLUESKY_IDENTIFIER` and `BLUESKY_APP_PASSWORD`.
- [`examples/mastodon`](examples/mastodon) shows `postStatus(...)` using `MASTODON_INSTANCE` and `MASTODON_ACCESS_TOKEN`.

Each example contains an event document plus an isolated Hooksmith configuration that can be adapted directly by consumers.

## Ecosystem

This repository follows its own release cadence and depends on the public Hooksmith contracts plus `@hooksmith/http`. It does not depend on the Hooksmith runtime engine.

See the [main Hooksmith repository](https://github.com/Kralizek/hooksmith) for the runtime, typed pipeline operators, CLI, GitHub Action, notification extensions, AWS integrations, and the complete extension catalog.

## Development

```sh
deno task check
```

## Release

Run the **Release** workflow manually and choose a `major`, `minor`, or `patch` version bump. All workspace packages are versioned and released together.

## License

MIT
