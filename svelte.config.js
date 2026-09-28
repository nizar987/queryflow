import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // adapter-node, not adapter-static: the query runner needs a server process
    // to speak the MySQL/Postgres/Mongo wire protocols — a browser cannot open
    // TCP sockets. The visualizer itself still runs entirely client-side.
    adapter: adapter(),
    prerender: {
      handleHttpError: 'warn'
    }
  }
};

export default config;
