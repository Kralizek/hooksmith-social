import type { Config, Event } from "@hooksmith/core";
import { postStatus } from "@hooksmith/mastodon";

interface PageData {
  title: string;
}

type PageEvent = Event<PageData>;

export default {
  routes: [
    {
      name: "publish-to-mastodon",
      listeners: [
        postStatus<PageEvent>({
          instance: Deno.env.get("MASTODON_INSTANCE")!,
          accessToken: Deno.env.get("MASTODON_ACCESS_TOKEN")!,
          status: (event) => `${event.data.title}\n\n${event.metadata?.url}`,
          visibility: "public",
        }),
      ],
    },
  ],
} satisfies Config<PageEvent>;
