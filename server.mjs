#!/usr/bin/env node
// Nano Banana image app: a self-hosted web studio for Nano Banana Pro, Nano Banana 2 and 2 Lite.
// Node.js 18+, no dependencies, no build step. The API key stays in this process; the browser
// only ever talks to this server.
//
//   export NANO_BANANA_API_KEY=...
//   node server.mjs            # then open http://127.0.0.1:5173

import { createServer } from "node:http";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { LIMITS, MODELS, costOf, validate } from "./lib/models.mjs";
import { UpstreamError, renderImages } from "./lib/upstream.mjs";

const PUBLIC_DIR = fileURLToPath(new URL("./public/", import.meta.url));
const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
};

const httpError = (status, message) => Object.assign(new Error(message), { status });

export function createApp({
  apiKey,
  baseUrl = "https://argolink.io/v1",
  galleryDir = "gallery",
  password = "",
  maxBodyBytes = 80 * 1024 * 1024,
  fetchImpl,
} = {}) {
  if (!apiKey) throw new Error("set NANO_BANANA_API_KEY");
  const historyFile = join(galleryDir, "history.jsonl");

  async function readJson(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > maxBodyBytes) throw httpError(413, "request too large");
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw httpError(400, "body must be JSON");
    }
  }

  function authorized(req) {
    if (!password) return true;
    const header = req.headers.authorization ?? "";
    if (!header.startsWith("Basic ")) return false;
    const supplied = Buffer.from(Buffer.from(header.slice(6), "base64").toString().split(":").slice(1).join(":"));
    const expected = Buffer.from(password);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }

  async function history() {
    try {
      return (await readFile(historyFile, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line));
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  async function generate(req) {
    const input = await readJson(req);
    const request = {
      model: input.model,
      prompt: input.prompt,
      aspect_ratio: input.aspect_ratio || undefined,
      resolution: input.resolution || undefined,
      n: input.n ?? 1,
      references: input.references ?? [],
    };
    const problem = validate(request);
    if (problem) throw httpError(400, problem);

    const images = await renderImages(request, { apiKey, baseUrl, fetchImpl });
    await mkdir(galleryDir, { recursive: true });
    const id = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const files = [];
    for (const [i, image] of images.entries()) {
      const name = `${id}-${i + 1}.jpg`;
      await writeFile(join(galleryDir, name), image);
      files.push(name);
    }
    const entry = {
      id,
      created_at: new Date().toISOString(),
      model: request.model,
      prompt: request.prompt,
      aspect_ratio: request.aspect_ratio ?? "1:1",
      resolution: request.resolution ?? "1k",
      references: request.references.length,
      files,
      cost: costOf(request.model, request.resolution, images.length),
    };
    await appendFile(historyFile, JSON.stringify(entry) + "\n");
    return entry;
  }

  return createServer(async (req, res) => {
    const send = (status, body, type = "application/json; charset=utf-8") => {
      res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      res.end(type.startsWith("application/json") ? JSON.stringify(body) : body);
    };
    try {
      if (!authorized(req)) {
        res.writeHead(401, { "WWW-Authenticate": 'Basic realm="nano-banana-image-app"' });
        return res.end();
      }
      const { pathname } = new URL(req.url, "http://localhost");
      if (req.method === "GET" && STATIC[pathname]) {
        const [file, type] = STATIC[pathname];
        return send(200, await readFile(join(PUBLIC_DIR, file)), type);
      }
      if (req.method === "GET" && pathname === "/api/models") return send(200, { models: MODELS, limits: LIMITS });
      if (req.method === "GET" && pathname === "/api/gallery") {
        const items = await history();
        const total = items.reduce((sum, item) => sum + item.cost, 0);
        return send(200, { items: items.reverse(), total_cost: Math.round(total * 10000) / 10000 });
      }
      if (req.method === "GET" && pathname.startsWith("/gallery/")) {
        const name = pathname.slice("/gallery/".length);
        if (!/^[\w-]+\.jpg$/.test(name)) return send(404, { error: "not found" });
        try {
          return send(200, await readFile(join(galleryDir, name)), "image/jpeg");
        } catch {
          return send(404, { error: "not found" });
        }
      }
      if (req.method === "POST" && pathname === "/api/generate") return send(200, await generate(req));
      return send(404, { error: "not found" });
    } catch (error) {
      if (error instanceof UpstreamError) return send(502, { error: error.message, upstream_status: error.status });
      if (error.status) return send(error.status, { error: error.message });
      if (error.name === "TimeoutError") return send(504, { error: "the image API did not answer within 10 minutes" });
      console.error(error);
      return send(500, { error: "internal error" });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = process.env.HOST ?? "127.0.0.1";
  const port = Number(process.env.PORT ?? 5173);
  const password = process.env.APP_PASSWORD ?? "";
  if (!["127.0.0.1", "localhost", "::1"].includes(host) && !password) {
    console.error(`refusing to listen on ${host} without APP_PASSWORD: anyone who reaches it could spend your credit`);
    process.exit(1);
  }
  const app = createApp({
    apiKey: process.env.NANO_BANANA_API_KEY,
    baseUrl: process.env.NANO_BANANA_BASE_URL || undefined,
    galleryDir: process.env.GALLERY_DIR || "gallery",
    password,
  });
  app.listen(port, host, () => console.log(`Nano Banana image app: http://${host.includes(":") ? `[${host}]` : host}:${port}`));
}
