// The UI is a client-rendered SPA: parsing, diagram layout and analysis all run
// in the browser and never need the server. `prerender` is off now that the app
// ships API routes (the query runner) — those must be served at request time.
export const ssr = false;
export const prerender = false;
export const trailingSlash = 'ignore';
