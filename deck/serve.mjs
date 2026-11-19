// Local draft server for the five-minute deck: node deck/serve.mjs → http://localhost:4400
//   /             audience view (P opens the presenter view)
//   /?presenter   presenter view: current + next slide, notes with timings, timer
// Every request rebuilds the page from deck/five-min/project, and the open pages reload themselves
// whenever a slide, deck.json or an image changes, so edits show up while you rehearse.
import { createReadStream, existsSync, watch } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { DECK, SOURCE, imageFiles } from "./viewer.mjs";

const PORT = Number(process.env.PORT) || 4400;
const TYPES = { ".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg" };
const listeners = new Set();

let pending = null;
const changed = () => {
    clearTimeout(pending);
    pending = setTimeout(() => { for (const response of listeners) response.write("event: change\ndata: x\n\n"); }, 150);
};
watch(SOURCE, { recursive: true }, changed);
watch(path.join(DECK, "assets/blob"), changed);
watch(path.join(DECK, "viewer.mjs"), changed);

createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    try {
        if (url.pathname === "/") {
            // viewer.mjs is re-imported on every request so changes to the presenter view need no restart
            const { buildPage: build } = await import(`./viewer.mjs?t=${Date.now()}`);
            const image = imageFiles();
            const html = build({ image: id => (image(id) ? `/assets/${image(id)}` : null), notes: true, reloadUrl: "/events" });
            response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
            return response.end(html);
        }
        if (url.pathname === "/events") {
            response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
            response.write(": connected\n\n");
            listeners.add(response);
            return request.on("close", () => listeners.delete(response));
        }
        const asset = url.pathname.match(/^\/assets\/([0-9a-f]{32}\.(webp|png|svg|jpg))$/);
        if (asset && existsSync(path.join(DECK, "assets/blob", asset[1]))) {
            response.writeHead(200, { "content-type": TYPES[path.extname(asset[1])], "cache-control": "no-store" });
            return createReadStream(path.join(DECK, "assets/blob", asset[1])).pipe(response);
        }
        response.writeHead(404).end("not found");
    } catch (error) {
        response.writeHead(500, { "content-type": "text/plain; charset=utf-8" }).end(String(error.stack ?? error));
    }
}).listen(PORT, () => console.log(`deck draft on http://localhost:${PORT} (presenter: http://localhost:${PORT}/?presenter)`));
