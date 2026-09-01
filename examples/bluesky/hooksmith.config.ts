import type { Config } from "@hooksmith/core";
import { post } from "@hooksmith/bluesky";

export default {
  routes: [
    {
      name: "publish-to-bluesky",
      listeners: [
        post({
          identifier: Deno.env.get("BLUESKY_IDENTIFIER")!,
          appPassword: Deno.env.get("BLUESKY_APP_PASSWORD")!,
          text: (event) => `${event.data.title}\n\n${event.metadata?.url}`,
        }),
      ],
    },
  ],
} satisfies Config;
