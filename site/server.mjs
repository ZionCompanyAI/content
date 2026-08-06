// Minimal static file server for the Astro static build output (dist/).
// No external deps on purpose — keeps the Railway image small and the
// build/start pipeline fully reproducible via nixpacks' Node provider.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const ROOT = join(process.cwd(), "dist");
const PORT = process.env.PORT || 4321;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

async function resolvePath(urlPath) {
  let safePath = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, "");
  let filePath = join(ROOT, safePath);

  try {
    const s = await stat(filePath);
    if (s.isDirectory()) {
      filePath = join(filePath, "index.html");
    }
  } catch {
    // not found as-is — try appending /index.html (Astro directory routing)
    filePath = join(ROOT, safePath, "index.html");
  }
  return filePath;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    let filePath = await resolvePath(url.pathname);

    let body;
    try {
      body = await readFile(filePath);
    } catch {
      // SPA-style fallback is wrong here (this is a real MPA) —
      // serve a real 404 page if present, else plain text.
      try {
        body = await readFile(join(ROOT, "404.html"));
        res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
        res.end(body);
        return;
      } catch {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("404 Not Found");
        return;
      }
    }

    const ext = extname(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "public, max-age=60" : "public, max-age=31536000, immutable",
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("500 Internal Server Error");
  }
});

server.listen(PORT, () => {
  console.log(`ZionCompanyAI site serving dist/ on :${PORT}`);
});
