// The page as served, before any script changes the DOM. main.js imports this
// first so "Download offline copy" saves a clean, working copy of the app.
export const PAGE_HTML = `<!DOCTYPE html>\n${document.documentElement.outerHTML}`;
