import type { Config } from "@hooksmith/core";
import { postStatus } from "@hooksmith/mastodon";

export default {
  routes: [
    {
      name: "publish-to-mastodon",
      listeners: [
        postStatus({
          instance: Deno.env.get("MASTODON_INSTANCE")!,
          accessToken: Deno.env.get("MASTODON_ACCESS_TOKEN")!,
          status: (event) => `${event.data.title}\n\n${event.metadata?.url}`,
          visibility: "public",
        }),
      ],
    },
  ],
} satisfies Config;
