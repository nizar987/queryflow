import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // Static adapter → fully local-only, parsing runs in the browser (PLAN §9: local-only default)
    adapter: adapter({
      fallback: 'index.html'
    }),
    prerender: {
      handleHttpError: 'warn'
    }
  }
};

export default config;
