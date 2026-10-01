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

/** External preview metadata attached to a Bluesky post. */
export interface BlueskyExternalPreview {
  uri: string | URL;
  title: string;
  description: string;
  image?: string | URL;
}

/** Options used to publish a Bluesky post from a Hooksmith event. */
export interface BlueskyPostOptions<TEvent extends Event = Event> {
  identifier: ValueOrFactory<string, TEvent>;
  appPassword: ValueOrFactory<string, TEvent>;
  text: ValueOrFactory<string, TEvent>;
  service?: ValueOrFactory<string | URL, TEvent>;
  languages?: ValueOrFactory<readonly string[], TEvent>;
  createdAt?: ValueOrFactory<string, TEvent>;
  external?: ValueOrFactory<BlueskyExternalPreview | undefined, TEvent>;
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

interface BlueskyUploadBlobResponse {
  blob: unknown;
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
const maxThumbnailBytes = 2_000_000;
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

      const external = options.external === undefined
        ? undefined
        : await resolve(options.external, event, context);
      const embed = external === undefined
        ? undefined
        : await prepareExternalEmbed(service, session, external, context);

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
            ...(embed === undefined ? {} : { embed }),
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

async function prepareExternalEmbed(
  service: string,
  session: BlueskySession,
  external: BlueskyExternalPreview,
  context: Context,
): Promise<Record<string, unknown>> {
  const thumb = external.image === undefined
    ? undefined
    : await tryUploadThumbnail(service, session, external.image, context);

  return {
    $type: "app.bsky.embed.external",
    external: {
      uri: String(external.uri),
      title: external.title,
      description: external.description,
      ...(thumb === undefined ? {} : { thumb }),
    },
  };
}

async function tryUploadThumbnail(
  service: string,
  session: BlueskySession,
  image: string | URL,
  context: Context,
): Promise<unknown | undefined> {
  const log = context.logger.getLogger("BlueskyExternalPreview");
  let imageUrl: URL;

  try {
    imageUrl = new URL(image);
  } catch (error) {
    log.warn(
      "Invalid Bluesky external preview image URL",
      {},
      error,
    );
    return undefined;
  }

  const logUrl = redactUrl(imageUrl);

  if (imageUrl.protocol !== "http:" && imageUrl.protocol !== "https:") {
    log.warn("Unsupported Bluesky external preview image protocol", {
      url: logUrl,
      protocol: imageUrl.protocol,
    });
    return undefined;
  }

  try {
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      log.warn("Could not fetch Bluesky external preview image", {
        url: logUrl,
        status: imageResponse.status,
      });
      return undefined;
    }

    const declaredLength = parseContentLength(
      imageResponse.headers.get("content-length"),
    );
    if (declaredLength !== undefined && declaredLength > maxThumbnailBytes) {
      log.warn("Bluesky external preview image exceeds maximum size", {
        url: logUrl,
        bytes: declaredLength,
        maxBytes: maxThumbnailBytes,
      });
      return undefined;
    }

    const contentType = imageResponse.headers.get("content-type") ??
      "application/octet-stream";
    const bytes = await readBoundedBody(imageResponse, maxThumbnailBytes);

    if (bytes === undefined) {
      log.warn("Bluesky external preview image exceeds maximum size", {
        url: logUrl,
        maxBytes: maxThumbnailBytes,
      });
      return undefined;
    }

    const uploadResponse = await fetch(
      `${service}/xrpc/com.atproto.repo.uploadBlob`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.accessJwt}`,
          "Content-Type": contentType,
        },
        body: bytes,
      },
    );

    if (!uploadResponse.ok) {
      log.warn("Could not upload Bluesky external preview image", {
        url: logUrl,
        status: uploadResponse.status,
      });
      return undefined;
    }

    const uploaded = await uploadResponse.json() as BlueskyUploadBlobResponse;
    return uploaded.blob;
  } catch (error) {
    log.warn(
      "Could not prepare Bluesky external preview image",
      { url: logUrl },
      error,
    );
    return undefined;
  }
}

function redactUrl(url: URL): string {
  const redacted = new URL(url);
  redacted.username = "";
  redacted.password = "";
  redacted.search = "";
  redacted.hash = "";
  return redacted.toString();
}

function parseContentLength(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array | undefined> {
  if (response.body === null) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return undefined;
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return result;
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
