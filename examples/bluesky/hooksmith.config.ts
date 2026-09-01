import type { Config, Event } from "@hooksmith/core";
import { post } from "@hooksmith/bluesky";

interface PageData {
  title: string;
}

type PageEvent = Event<PageData>;

export default {
  routes: [
    {
      name: "publish-to-bluesky",
      listeners: [
        post<PageEvent>({
          identifier: Deno.env.get("BLUESKY_IDENTIFIER")!,
          appPassword: Deno.env.get("BLUESKY_APP_PASSWORD")!,
          text: (event) => `${event.data.title}\n\n${event.metadata?.url}`,
        }),
      ],
    },
  ],
} satisfies Config<PageEvent>;
