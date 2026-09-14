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
  codeUnitStart: number;
  codeUnitEnd: number;
  feature: BlueskyFacetFeature;
}

interface PreparedRichText {
  text: string;
  facets: BlueskyFacet[];
}

const maxGraphemeLength = 300;
const maxLinkDisplayLength = 30;
const linkPattern = /https?:\/\/(?:(?!,https?:\/\/)[^\s<>"'])+/giu;
const trailingDelimiters = /[.,!?;:)\]}]+$/u;
const tagPattern = /(^|[^\p{L}\p{N}_])#([\p{L}\p{N}_-]+)/gu;
const encoder = new TextEncoder();
const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
});

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
      const sourceText = await resolve(options.text, event, context);
      const createdAt = options.createdAt === undefined
        ? new Date().toISOString()
        : await resolve(options.createdAt, event, context);
      const languages = options.languages === undefined
        ? undefined
        : await resolve(options.languages, event, context);
      const richText = prepareRichText(sourceText);
      const graphemeLength = countGraphemes(richText.text);

      if (graphemeLength > maxGraphemeLength) {
        return {
          success: false,
          message:
            `Bluesky post text is ${graphemeLength} graphemes; maximum is ${maxGraphemeLength}.`,
          data: {
            graphemeLength,
            maxGraphemeLength,
          },
        };
      }

      return await httpPost<TEvent>({
        url: `${service}/xrpc/com.atproto.repo.createRecord`,
        headers: bearerAuth(session.accessJwt),
        body: jsonBody({
          repo: session.did,
          collection: "app.bsky.feed.post",
          record: {
            $type: "app.bsky.feed.post",
            text: richText.text,
            createdAt,
            ...(languages === undefined ? {} : { langs: languages }),
            ...(richText.facets.length === 0
              ? {}
              : { facets: richText.facets }),
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

function prepareRichText(text: string): PreparedRichText {
  const detected = detectFacets(text);
  if (detected.length === 0) {
    return { text, facets: [] };
  }

  let cursor = 0;
  let preparedText = "";
  const prepared: DetectedFacet[] = [];

  for (const facet of detected) {
    preparedText += text.slice(cursor, facet.codeUnitStart);

    const original = text.slice(facet.codeUnitStart, facet.codeUnitEnd);
    const display = facet.feature.$type === "app.bsky.richtext.facet#link"
      ? shortenUrl(original)
      : original;

    const codeUnitStart = preparedText.length;
    preparedText += display;
    const codeUnitEnd = preparedText.length;

    prepared.push({
      codeUnitStart,
      codeUnitEnd,
      feature: facet.feature,
    });

    cursor = facet.codeUnitEnd;
  }

  preparedText += text.slice(cursor);

  return {
    text: preparedText,
    facets: materializeFacets(preparedText, prepared),
  };
}

function detectFacets(text: string): DetectedFacet[] {
  const detected: DetectedFacet[] = [];

  for (const match of text.matchAll(linkPattern)) {
    const codeUnitStart = match.index;
    if (codeUnitStart === undefined) continue;

    const uri = match[0].replace(trailingDelimiters, "");
    if (uri.length === 0) continue;

    detected.push({
      codeUnitStart,
      codeUnitEnd: codeUnitStart + uri.length,
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
    const codeUnitStart = matchStart + prefix.length;
    const codeUnitEnd = codeUnitStart + tag.length + 1;

    if (overlapsDetected(codeUnitStart, codeUnitEnd, detected)) continue;

    detected.push({
      codeUnitStart,
      codeUnitEnd,
      feature: {
        $type: "app.bsky.richtext.facet#tag",
        tag,
      },
    });
  }

  return detected.sort((left, right) =>
    left.codeUnitStart - right.codeUnitStart
  );
}

function materializeFacets(
  text: string,
  detected: readonly DetectedFacet[],
): BlueskyFacet[] {
  return detected.map(({ codeUnitStart, codeUnitEnd, feature }) => {
    const byteStart = encoder.encode(text.slice(0, codeUnitStart)).length;
    const byteEnd = byteStart +
      encoder.encode(text.slice(codeUnitStart, codeUnitEnd)).length;

    return {
      index: { byteStart, byteEnd },
      features: [feature],
    };
  });
}

function shortenUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return value;
    }

    const path = (url.pathname === "/" ? "" : url.pathname) +
      url.search + url.hash;
    const display = `${url.host}${path}`;
    const graphemes = [...graphemeSegmenter.segment(display)].map((part) =>
      part.segment
    );

    return graphemes.length > maxLinkDisplayLength
      ? `${graphemes.slice(0, maxLinkDisplayLength - 1).join("")}…`
      : display;
  } catch {
    return value;
  }
}

function countGraphemes(text: string): number {
  return [...graphemeSegmenter.segment(text)].length;
}

function overlapsDetected(
  codeUnitStart: number,
  codeUnitEnd: number,
  detected: readonly DetectedFacet[],
): boolean {
  return detected.some((existing) =>
    codeUnitStart < existing.codeUnitEnd &&
    codeUnitEnd > existing.codeUnitStart
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
