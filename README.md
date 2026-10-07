# Nano Banana Image App — a self-hosted studio for Nano Banana Pro, 2 and 2 Lite

A small web app for generating and editing images with Google's Nano Banana models: type a prompt, pick the model, aspect ratio and resolution, drop in up to 14 reference images, and every result lands in a local gallery with what it cost. One Node.js server file and one HTML page, no dependencies, no build step, no database. Your API key stays on the server.

It calls any OpenAI-style Images API. The default is [ArgoLink](https://argolink.io/gh-nano-banana-image-app), where Nano Banana Pro is $0.03 per image at 1K, 2K or 4K.

[Quickstart](#quickstart) · [What it costs](#what-it-costs) · [Configuration](#configuration) · [HTTP API](#the-apps-own-http-api) · [Security](#security) · [FAQ](#faq)

<sub>Last checked: 2026-10-07 (model limits and prices in `lib/models.mjs`).</sub>

## Highlights

- **Three models, one form.** Nano Banana Pro, Nano Banana 2 and Nano Banana 2 Lite, with the aspect-ratio and resolution menus limited to what each model accepts, so a request the model would refuse never leaves your machine.
- **Edits by drag and drop.** Add reference images and the request becomes an image-to-image edit; any gallery image has a "Use as reference" button, so iterating on a result is one click.
- **A running bill.** Each request shows its price before you send it, each gallery card shows what it cost, and the header keeps the total.
- **Files you own.** Images are saved as JPEGs in `gallery/` and every request is one line of JSON in `gallery/history.jsonl` (prompt, model, ratio, tier, files, cost).
- **Safe defaults.** Listens on 127.0.0.1 only; refuses to bind a public address unless `APP_PASSWORD` is set.

## Quickstart

### Node.js 18 or newer

```bash
git clone https://github.com/vivienneashe/nano-banana-image-app
cd nano-banana-image-app
export NANO_BANANA_API_KEY=your-key      # get one at argolink.io, or use your own endpoint below
node server.mjs
```

Open http://127.0.0.1:5173, write a prompt, press **Generate**. The API answers only when the images are finished, 2K and 4K take longer than 1K, and the page counts the seconds while it waits.

### Docker

```bash
docker build -t nano-banana-image-app .
docker run --rm -p 5173:5173 \
  -e NANO_BANANA_API_KEY=your-key -e APP_PASSWORD=choose-one \
  -v "$PWD/gallery:/data" nano-banana-image-app
```

Inside the container the app binds 0.0.0.0, so it requires `APP_PASSWORD` and asks the browser for it (any user name).

## What it costs

You pay the image API per returned image; the app adds nothing. Per image on the default endpoint, with Google's own Gemini API rate for the same model alongside:

| Model | 1K | 2K | 4K | Google list price (1K / 2K / 4K) |
|---|---:|---:|---:|---:|
| Nano Banana Pro | $0.03 | $0.03 | $0.03 | $0.134 / $0.134 / $0.24 |
| Nano Banana 2 | $0.02 | $0.02 | $0.025 | $0.067 / $0.101 / $0.151 |
| Nano Banana 2 Lite | $0.01 | — | — | $0.0336 / — / — |

<sub>Sources checked 2026-10-07: [ArgoLink Nano Banana Pro page](https://argolink.io/en/models/nano-banana-pro) and its sibling pages; [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) (standard tier, image output only; Google bills prompt and input-image tokens on top).</sub>

A typical session, 40 drafts on 2 Lite plus 8 finals on Pro at 4K, comes to 40 × $0.01 + 8 × $0.03 = **$0.64**. The `n` menu asks for up to 4 images in one request, and each one is billed.

## Where everything lives

| What | Where |
|---|---|
| Generated images | `gallery/<timestamp>-<id>-<n>.jpg` (JPEG, as the models return it) |
| Request log | `gallery/history.jsonl`, one JSON object per request |
| Model limits and prices | `lib/models.mjs`, the only place to edit when the provider changes them |
| Calls to the image API | `lib/upstream.mjs` |
| Server and routes | `server.mjs` |
| Browser UI | `public/index.html`, `public/app.js`, `public/style.css` |

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `NANO_BANANA_API_KEY` | — | required; sent as `Authorization: Bearer …` to the image API |
| `NANO_BANANA_BASE_URL` | `https://argolink.io/v1` | any endpoint with `/images/generations` and `/images/edits` that accepts these model IDs |
| `HOST` | `127.0.0.1` | interface to bind; anything other than loopback needs `APP_PASSWORD` |
| `PORT` | `5173` | port |
| `APP_PASSWORD` | empty | turns on HTTP basic auth for every route |
| `GALLERY_DIR` | `gallery` | where images and `history.jsonl` go |

## How a request flows

1. The browser sends prompt, model, ratio, tier, `n` and any reference images (as data URLs) to `POST /api/generate`.
2. The server checks them against `lib/models.mjs`: an unknown ratio, 4K on 2 Lite, more than 4 images or more than 14 references get a 400 here, before any spend.
3. No references: `POST {base}/images/generations` with a JSON body. With references: `POST {base}/images/edits` as multipart, one `image[]` field per image.
4. The API answers when every image is ready (the server waits up to 10 minutes) with base64 JPEGs in `data[].b64_json`.
5. The server writes the files, appends the log line and returns the entry; the page refreshes the gallery.

Two model rules the form enforces for you: the output is 1:1 unless you choose a ratio, edits included, and `response_format` is base64 only, so there is no URL to expire.

## The app's own HTTP API

The UI is one client of four routes, so scripts can use them too:

| Route | Does |
|---|---|
| `GET /api/models` | model IDs, ratios, tiers and prices the server enforces |
| `POST /api/generate` | `{model, prompt, aspect_ratio?, resolution?, n?, references?: [data URLs]}` → the saved gallery entry |
| `GET /api/gallery` | every entry, newest first, plus `total_cost` |
| `GET /gallery/<file>.jpg` | one saved image |

```bash
curl -s http://127.0.0.1:5173/api/generate -H "Content-Type: application/json" \
  -d '{"model":"nano-banana-2","prompt":"Flat lay of a ceramic mug and a notebook","aspect_ratio":"4:3","resolution":"2k","n":2}'
```

## Security

- The key is read from the environment and only ever sent to the image API; the browser never receives it.
- Default bind is loopback. On another interface the server will not start without `APP_PASSWORD`; put it behind HTTPS (a reverse proxy) before exposing it beyond your LAN.
- `/gallery/` serves only names matching `[A-Za-z0-9_-]+.jpg`, so `history.jsonl` and anything outside the folder stay private.
- Request bodies over 80 MB are refused.

## FAQ

**Which model should I start with?**
Nano Banana 2 at 1K or 2K ($0.02) for most work. Drop to 2 Lite ($0.01, 1K only) while you explore a prompt, and switch to Pro for finals: its 4K costs the same $0.03 as its 1K.

**Can I use my own Google key instead?**
Not directly: Google's Gemini API has its own request format, and this app speaks the OpenAI-style Images protocol. Point `NANO_BANANA_BASE_URL` at any gateway that serves these model IDs on that protocol.

**Why is my edited image square?**
The models default to 1:1 for edits as well. The form always sends the ratio you pick, so choose it before you press the button.

**Can several people use one instance?**
Yes, with `APP_PASSWORD` set they share the key, the gallery and the bill. There are no per-user accounts or quotas; that is the line where a bigger tool makes more sense.

**Does it keep my prompts?**
Only in `gallery/history.jsonl` on your disk. Delete the folder to forget everything.

## Run the tests

```bash
npm test
```

The tests start a fake image API on localhost, so they need no key and spend nothing.

## License

MIT. An independent project, not affiliated with Google; Nano Banana is Google's name for these models.
