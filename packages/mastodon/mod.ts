import type { Context, Event, Listener } from "@hooksmith/core";
import {
  bearerAuth,
  expectStatus,
  formBody,
  headers,
  httpPost,
  type ValueOrFactory,
} from "@hooksmith/http";

/** Visibility levels accepted when publishing a Mastodon status. */
export type MastodonVisibility = "public" | "unlisted" | "private" | "direct";

/** Metadata returned after successfully publishing a Mastodon status. */
export interface MastodonStatusResult {
  id: string;
  url?: string;
  uri: string;
  createdAt: string;
}

/** Options used to publish a Mastodon status from a Hooksmith event. */
export interface MastodonStatusOptions<TEvent extends Event = Event> {
  instance: ValueOrFactory<string | URL, TEvent>;
  accessToken: ValueOrFactory<string, TEvent>;
  status: ValueOrFactory<string, TEvent>;
  visibility?: ValueOrFactory<MastodonVisibility, TEvent>;
  language?: ValueOrFactory<string, TEvent>;
  spoilerText?: ValueOrFactory<string, TEvent>;
  sensitive?: ValueOrFactory<boolean, TEvent>;
  idempotencyKey?: ValueOrFactory<string, TEvent>;
}

interface MastodonStatusResponse {
  id: string;
  url?: string | null;
  uri: string;
  created_at: string;
}

interface MastodonErrorResponse {
  error?: string;
}

export function postStatus<TEvent extends Event = Event>(
  options: MastodonStatusOptions<TEvent>,
): Listener<TEvent> {
  const requestHeaders = options.idempotencyKey === undefined
    ? bearerAuth(options.accessToken)
    : headers(
      bearerAuth(options.accessToken),
      async (event, context) => ({
        "Idempotency-Key": await resolve(
          options.idempotencyKey!,
          event,
          context,
        ),
      }),
    );

  return httpPost({
    url: async (event, context) => {
      const instance = await resolve(options.instance, event, context);
      return `${String(instance).replace(/\/+$/, "")}/api/v1/statuses`;
    },
    headers: requestHeaders,
    body: formBody(async (event, context) => {
      const values: Record<string, string> = {
        status: await resolve(options.status, event, context),
      };

      if (options.visibility !== undefined) {
        values.visibility = await resolve(options.visibility, event, context);
      }
      if (options.language !== undefined) {
        values.language = await resolve(options.language, event, context);
      }
      if (options.spoilerText !== undefined) {
        values.spoiler_text = await resolve(
          options.spoilerText,
          event,
          context,
        );
      }
      if (options.sensitive !== undefined) {
        values.sensitive = String(
          await resolve(options.sensitive, event, context),
        );
      }

      return values;
    }),
    response: {
      parse: "json",
      success: expectStatus(200),
      successMap: ({ body }): MastodonStatusResult => {
        const status = body as MastodonStatusResponse;
        return {
          id: status.id,
          ...(status.url ? { url: status.url } : {}),
          uri: status.uri,
          createdAt: status.created_at,
        };
      },
      errorMap: ({ status, body }) => ({
        status,
        error: (body as MastodonErrorResponse | undefined)?.error,
      }),
    },
  });
}

async function resolve<T, TEvent extends Event>(
  value: ValueOrFactory<T, TEvent>,
  event: TEvent,
  context: Context,
): Promise<T> {
  return typeof value === "function"
    ? await (value as (
      event: TEvent,
      context: Context,
    ) => T | Promise<T>)(event, context)
    : value;
}
