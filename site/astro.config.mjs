import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://zioncompanyai.com.br",
  output: "static",
  compressHTML: true,
  integrations: [sitemap()],
});
