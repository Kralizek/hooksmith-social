import type { Context, Event, Listener, ListenerResult } from "@hooksmith/core";
import {
  bearerAuth,
  expectStatus,
  httpPost,
  jsonBody,
  type ValueOrFactory,
} from "@hooksmith/http";

/** Identifiers returned by Bluesky after creating a post record. */
export interface BlueskyPostResult {
  uri: string;
  cid: string;
}

/** Options used to publish a Bluesky post from a Hooksmith event. */
export interface BlueskyPostOptions<TEvent extends Event = Event> {
  identifier: ValueOrFactory<string, TEvent>;
  appPassword: ValueOrFactory<string, TEvent>;
  text: ValueOrFactory<string, TEvent>;
  service?: ValueOrFactory<string | URL, TEvent>;
  languages?: ValueOrFactory<readonly string[], TEvent>;
  createdAt?: ValueOrFactory<string, TEvent>;
}

interface BlueskySession {
  did: string;
  accessJwt: string;
}

interface BlueskyCreateRecordResponse {
  uri: string;
  cid: string;
}

interface BlueskyErrorResponse {
  error?: string;
  message?: string;
}

type BlueskyFacetFeature =
  | {
    $type: "app.bsky.richtext.facet#link";
    uri: string;
  }
  | {
    $type: "app.bsky.richtext.facet#mention";
    did: string;
  }
  | {
    $type: "app.bsky.richtext.facet#tag";
    tag: string;
  };

interface BlueskyFacet {
  index: {
    byteStart: number;
    byteEnd: number;
  };
  features: BlueskyFacetFeature[];
}

interface DetectedFacet {
  characterStart: number;
  characterEnd: number;
  feature: BlueskyFacetFeature;
}

const linkPattern = /https?:\/\/(?:(?!,https?:\/\/)[^\s<>"'])+/giu;
const trailingDelimiters = /[.,!?;:)\]}]+$/u;
const tagPattern = /(^|[^\p{L}\p{N}_])#([\p{L}\p{N}_-]+)/gu;
const encoder = new TextEncoder();

export function post<TEvent extends Event = Event>(
  options: BlueskyPostOptions<TEvent>,
): Listener<TEvent> {
  return {
    name: "bluesky-post",
    async run(event, context): Promise<ListenerResult> {
      const service = String(
        await resolve(options.service ?? "https://bsky.social", event, context),
      ).replace(/\/+$/, "");

      const sessionResult = await httpPost<TEvent>({
        url: `${service}/xrpc/com.atproto.server.createSession`,
        body: jsonBody<TEvent>(
          async (current: TEvent, currentContext: Context) => ({
            identifier: await resolve(
              options.identifier,
              current,
              currentContext,
            ),
            password: await resolve(
              options.appPassword,
              current,
              currentContext,
            ),
          }),
        ),
        response: {
          parse: "json",
          success: expectStatus(200),
          successMap: ({ body }) => body as BlueskySession,
          errorMap: ({ status, body }) => ({
            status,
            ...(body as BlueskyErrorResponse | undefined),
          }),
        },
      }).run(event, context);

      if (!sessionResult.success) {
        return {
          success: false,
          message: `Bluesky authentication failed: ${
            sessionResult.message ?? "request failed"
          }`,
          data: sessionResult.data,
        };
      }

      const session = sessionResult.data as BlueskySession;
      const text = await resolve(options.text, event, context);
      const createdAt = options.createdAt === undefined
        ? new Date().toISOString()
        : await resolve(options.createdAt, event, context);
      const languages = options.languages === undefined
        ? undefined
        : await resolve(options.languages, event, context);
      const facets = detectFacets(text);

      return await httpPost<TEvent>({
        url: `${service}/xrpc/com.atproto.repo.createRecord`,
        headers: bearerAuth(session.accessJwt),
        body: jsonBody({
          repo: session.did,
          collection: "app.bsky.feed.post",
          record: {
            $type: "app.bsky.feed.post",
            text,
            createdAt,
            ...(languages === undefined ? {} : { langs: languages }),
            ...(facets.length === 0 ? {} : { facets }),
          },
        }),
        response: {
          parse: "json",
          success: expectStatus(200),
          successMap: ({ body }): BlueskyPostResult => {
            const created = body as BlueskyCreateRecordResponse;
            return { uri: created.uri, cid: created.cid };
          },
          errorMap: ({ status, body }) => ({
            status,
            ...(body as BlueskyErrorResponse | undefined),
          }),
        },
      }).run(event, context);
    },
  };
}

function detectFacets(text: string): BlueskyFacet[] {
  const detected: DetectedFacet[] = [];

  for (const match of text.matchAll(linkPattern)) {
    const characterStart = match.index;
    if (characterStart === undefined) continue;

    const uri = match[0].replace(trailingDelimiters, "");
    if (uri.length === 0) continue;

    detected.push({
      characterStart,
      characterEnd: characterStart + uri.length,
      feature: {
        $type: "app.bsky.richtext.facet#link",
        uri,
      },
    });
  }

  for (const match of text.matchAll(tagPattern)) {
    const matchStart = match.index;
    if (matchStart === undefined) continue;

    const prefix = match[1];
    const tag = match[2];
    const characterStart = matchStart + prefix.length;
    const characterEnd = characterStart + tag.length + 1;

    if (overlapsDetected(characterStart, characterEnd, detected)) continue;

    detected.push({
      characterStart,
      characterEnd,
      feature: {
        $type: "app.bsky.richtext.facet#tag",
        tag,
      },
    });
  }

  return detected
    .sort((left, right) => left.characterStart - right.characterStart)
    .map(({ characterStart, characterEnd, feature }) => {
      const byteStart = encoder.encode(text.slice(0, characterStart)).length;
      const byteEnd = byteStart +
        encoder.encode(text.slice(characterStart, characterEnd)).length;

      return {
        index: { byteStart, byteEnd },
        features: [feature],
      };
    });
}

function overlapsDetected(
  characterStart: number,
  characterEnd: number,
  detected: readonly DetectedFacet[],
): boolean {
  return detected.some((existing) =>
    characterStart < existing.characterEnd &&
    characterEnd > existing.characterStart
  );
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
