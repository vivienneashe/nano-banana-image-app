// Offline tests: a fake image API runs on localhost, so no key is used and nothing is billed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server.mjs";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function fakeApi({ status = 200 } = {}) {
  const seen = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    const json = req.headers["content-type"] === "application/json";
    seen.push({ url: req.url, headers: req.headers, raw, body: json ? JSON.parse(raw) : null });
    if (status !== 200) {
      res.writeHead(status, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: { message: "aspect ratio not supported" } }));
    }
    const n = json ? JSON.parse(raw).n : Number(/name="n"\r\n\r\n(\d)/.exec(raw.toString("latin1"))[1]);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: Array.from({ length: n }, () => ({ b64_json: JPEG.toString("base64") })) }));
  });
  const url = await listen(server);
  return { url: `${url}/v1`, seen, close: () => server.close() };
}

async function startApp(api, options = {}) {
  const galleryDir = await mkdtemp(join(tmpdir(), "gallery-"));
  const app = createApp({ apiKey: "test-key", baseUrl: api.url, galleryDir, ...options });
  const url = await listen(app);
  return { url, galleryDir, close: () => app.close() };
}

const post = (url, body, headers = {}) =>
  fetch(`${url}/api/generate`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

test("text to image goes to /images/generations as JSON and lands in the gallery", async () => {
  const api = await fakeApi();
  const app = await startApp(api);
  try {
    const response = await post(app.url, { model: "nano-banana-pro", prompt: "a teapot", aspect_ratio: "16:9", resolution: "4k", n: 2 });
    const entry = await response.json();
    assert.equal(response.status, 200);
    assert.equal(api.seen[0].url, "/v1/images/generations");
    assert.equal(api.seen[0].headers.authorization, "Bearer test-key");
    assert.deepEqual(api.seen[0].body, { model: "nano-banana-pro", prompt: "a teapot", n: 2, aspect_ratio: "16:9", resolution: "4k" });
    assert.equal(entry.files.length, 2);
    assert.equal(entry.cost, 0.06);
    assert.deepEqual(await readFile(join(app.galleryDir, entry.files[0])), JPEG);
    const gallery = await (await fetch(`${app.url}/api/gallery`)).json();
    assert.equal(gallery.total_cost, 0.06);
  } finally {
    app.close();
    api.close();
  }
});

test("references turn the request into a multipart edit with one image[] per file", async () => {
  const api = await fakeApi();
  const app = await startApp(api);
  try {
    const ref = `data:image/png;base64,${Buffer.from("PNG-BYTES").toString("base64")}`;
    const response = await post(app.url, { model: "nano-banana-2", prompt: "make it autumn", aspect_ratio: "4:3", references: [ref, ref] });
    assert.equal(response.status, 200);
    const { url, headers, raw } = api.seen[0];
    assert.equal(url, "/v1/images/edits");
    assert.match(headers["content-type"], /^multipart\/form-data; boundary=/);
    const text = raw.toString("latin1");
    assert.equal(text.split('name="image[]"').length - 1, 2);
    assert.ok(text.includes("PNG-BYTES"));
  } finally {
    app.close();
    api.close();
  }
});

test("a request the model cannot serve is refused before it costs anything", async () => {
  const api = await fakeApi();
  const app = await startApp(api);
  try {
    const response = await post(app.url, { model: "nano-banana-2-lite", prompt: "x", resolution: "4k" });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /does not render 4k/);
    assert.equal(api.seen.length, 0);
    assert.deepEqual(await readdir(app.galleryDir), []);
  } finally {
    app.close();
    api.close();
  }
});

test("an API error comes back as 502 with the upstream status", async () => {
  const api = await fakeApi({ status: 400 });
  const app = await startApp(api);
  try {
    const response = await post(app.url, { model: "nano-banana-2", prompt: "x" });
    const body = await response.json();
    assert.equal(response.status, 502);
    assert.equal(body.upstream_status, 400);
  } finally {
    app.close();
    api.close();
  }
});

test("the gallery route only serves its own JPEG files", async () => {
  const api = await fakeApi();
  const app = await startApp(api);
  try {
    for (const path of ["/gallery/..%2Fserver.mjs", "/gallery/history.jsonl", "/gallery/x.png"]) {
      assert.equal((await fetch(app.url + path)).status, 404);
    }
  } finally {
    app.close();
    api.close();
  }
});

test("APP_PASSWORD puts every route behind basic auth", async () => {
  const api = await fakeApi();
  const app = await startApp(api, { password: "s3cret" });
  try {
    assert.equal((await fetch(`${app.url}/api/models`)).status, 401);
    const auth = { Authorization: `Basic ${Buffer.from("me:s3cret").toString("base64")}` };
    assert.equal((await fetch(`${app.url}/api/models`, { headers: auth })).status, 200);
  } finally {
    app.close();
    api.close();
  }
});
