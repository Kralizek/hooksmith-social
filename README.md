# hooksmith-social

Social publishing extensions for
[Hooksmith](https://github.com/Kralizek/hooksmith).

## Packages

| Package                                                     | Purpose                                                                      |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [`@hooksmith/bluesky`](https://jsr.io/@hooksmith/bluesky)   | Publish posts to Bluesky using an account identifier and app password.       |
| [`@hooksmith/mastodon`](https://jsr.io/@hooksmith/mastodon) | Publish statuses to Mastodon-compatible instances using a user access token. |

Both packages build on `@hooksmith/http` and expose Hooksmith listeners rather
than standalone API clients.

## Examples

- [`examples/bluesky`](examples/bluesky) shows `post(...)` using
  `BLUESKY_IDENTIFIER` and `BLUESKY_APP_PASSWORD`.
- [`examples/mastodon`](examples/mastodon) shows `postStatus(...)` using
  `MASTODON_INSTANCE` and `MASTODON_ACCESS_TOKEN`.

Each example contains an event document plus a Hooksmith configuration that can
be adapted directly by consumers.

## Development

```sh
deno task check
```

## Release

Run the **Release** workflow manually and choose a `major`, `minor`, or `patch`
version bump. All workspace packages are versioned and released together.

## License

MIT
