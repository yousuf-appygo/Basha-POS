import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { handleApi } from "./backend/routes.js";
import { withApiLock, applySecurityHeaders, sendJson } from "./backend/utils.js";

const rootDir = join(fileURLToPath(import.meta.url), "..", "..");
const frontendDir = join(rootDir, "src", "frontend");

// One-time startup diagnostics only - never do blocking log writes on the
// request hot path (previously every single static request appended a line
// to static-requests.log with a synchronous fs call, which serializes all
// static traffic behind disk I/O).
try {
  writeFileSync("server-paths.log", JSON.stringify({
    importMetaUrl: import.meta.url,
    fileURLToPath: fileURLToPath(import.meta.url),
    rootDir,
    frontendDir,
    cwd: process.cwd()
  }, null, 2));
} catch (e) {}
const port = Number(process.env.PORT || 3000);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

// Text types benefit from gzip; binary image formats are already compressed
// so re-gzipping them just burns CPU for no size benefit.
const compressibleTypes = new Set([".html", ".css", ".js", ".json", ".svg"]);

// In-memory static asset cache: avoids hitting disk on every request for
// files that rarely change (app.js alone is ~1MB, read fresh on every load
// previously). Each entry is validated against the file's mtime+size on
// every request via a cheap stat() call, so edits are still picked up
// without a server restart, but the (much more expensive) full file read
// and gzip compression only happen once per change.
const staticCache = new Map(); // filePath -> { mtimeMs, size, buffer, gzipBuffer }

async function readStaticFile(filePath) {
  const stats = await stat(filePath);
  const cached = staticCache.get(filePath);
  if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
    return cached;
  }
  const buffer = await readFile(filePath);
  const ext = extname(filePath);
  const entry = {
    mtimeMs: stats.mtimeMs,
    size: stats.size,
    buffer,
    gzipBuffer: compressibleTypes.has(ext) ? gzipSync(buffer) : null
  };
  staticCache.set(filePath, entry);
  return entry;
}

async function serveStatic(req, res, pathname) {
  let targetPath = pathname;
  const hasExtension = extname(pathname) !== "";
  
  if (pathname === "/billing" || pathname === "/billing/") {
    targetPath = "/index.html";
  } else if (pathname.startsWith("/billing/")) {
    if (hasExtension) {
      // If it's a file request under /billing/ (e.g. /billing/styles.css), strip the "/billing" prefix to auto-heal relative paths
      targetPath = pathname.substring(8);
    } else {
      // If it's a client-side sub-route (e.g. /billing/dashboard), serve index.html
      targetPath = "/index.html";
    }
  }
  const safePath = normalize(targetPath === "/" ? "/index.html" : targetPath).replace(/^(\.\.[/\\])+/, "");
  const cleanPath = safePath.replace(/^[/\\]+/, "");
  const filePath = join(frontendDir, cleanPath);
  
  if (!filePath.startsWith(frontendDir) && !cleanPath.startsWith("assets/")) {
    console.error(`[Static Forbidden] Path: ${pathname}, resolved: ${filePath}, frontendDir: ${frontendDir}`);
    res.writeHead(403);
    return res.end("Forbidden");
  }

  try {
    let entry;
    let finalPath = filePath;
    try {
      entry = await readStaticFile(filePath);
    } catch (err) {
      if (cleanPath.startsWith("assets/")) {
        const filename = cleanPath.substring(7); // strip "assets/"
        const pathsToTry = [
          join(rootDir, "src", "frontend", "assets", filename),
          join(rootDir, "src", "assets", "images", filename),
          join(rootDir, "src", "assets", filename)
        ];
        let found = false;
        for (const p of pathsToTry) {
          try {
            entry = await readStaticFile(p);
            finalPath = p;
            found = true;
            break;
          } catch (e) {
            // continue trying
          }
        }
        if (!found) {
          throw err;
        }
      } else {
        throw err;
      }
    }

    applySecurityHeaders(req, res);
    const ext = extname(finalPath);
    const headers = {
      "content-type": contentTypes[ext] || "application/octet-stream",
      // Fingerprinted/binary assets (images) rarely change and can be cached
      // aggressively by the browser; JS/CSS/HTML are revalidated on every
      // load (cheap 304s) since they aren't content-hashed in the filename.
      "cache-control": cleanPath.startsWith("assets/")
        ? "public, max-age=86400"
        : "no-cache"
    };

    const acceptEncoding = req.headers["accept-encoding"] || "";
    if (entry.gzipBuffer && acceptEncoding.includes("gzip")) {
      headers["content-encoding"] = "gzip";
      headers["content-length"] = entry.gzipBuffer.length;
      res.writeHead(200, headers);
      res.end(entry.gzipBuffer);
    } else {
      headers["content-length"] = entry.buffer.length;
      res.writeHead(200, headers);
      res.end(entry.buffer);
    }
  } catch (err) {
    console.error(`[Static Not Found] Path: ${pathname}, cleanPath: ${cleanPath}, error: ${err.message}`);
    res.writeHead(404);
    res.end("Not Found");
  }
}

const server = createServer(async (req, res) => {
  try {
    applySecurityHeaders(req, res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }
    const { pathname } = new URL(req.url, `http://${req.headers.host}`);
    if (pathname.startsWith("/api/")) {
      return await handleApi(req, res, pathname);
    }
    return await serveStatic(req, res, pathname);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error" });
  }
}).listen(port, () => {
  console.log(`Basha Restaurant OS running at http://localhost:${port} with separate modular backend and frontend`);
});

async function shutdown() {
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
export { server };
