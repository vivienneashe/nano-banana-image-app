// The one place that talks to the image API. Text-only requests go to /images/generations as JSON;
// requests with reference images go to /images/edits as multipart, one image[] field per file.

export class UpstreamError extends Error {
  constructor(status, body) {
    super(`image API returned ${status}: ${String(body).slice(0, 300)}`);
    this.status = status;
    this.body = body;
  }
}

function dataUrlToBlob(dataUrl) {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) throw new UpstreamError(400, "reference is not a base64 data URL");
  return new Blob([Buffer.from(match[2], "base64")], { type: match[1] });
}

/**
 * Renders images and resolves to an array of JPEG Buffers.
 * The API answers only when every image is finished, so the timeout is long.
 */
export async function renderImages(
  { model, prompt, aspect_ratio, resolution, n = 1, references = [] },
  { apiKey, baseUrl, fetchImpl = fetch, timeoutMs = 600_000 },
) {
  const fields = { model, prompt, n, ...(aspect_ratio ? { aspect_ratio } : {}), ...(resolution ? { resolution } : {}) };
  const headers = { Authorization: `Bearer ${apiKey}` };
  let path = "/images/generations";
  let body;
  if (references.length) {
    path = "/images/edits";
    body = new FormData();
    for (const [key, value] of Object.entries(fields)) body.append(key, String(value));
    references.forEach((ref, i) => {
      const blob = dataUrlToBlob(ref);
      body.append("image[]", blob, `reference-${i + 1}.${blob.type.split("/")[1] || "png"}`);
    });
  } else {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(fields);
  }
  const response = await fetchImpl(baseUrl.replace(/\/+$/, "") + path, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) throw new UpstreamError(response.status, text);
  const data = JSON.parse(text).data ?? [];
  return data.map((item) => Buffer.from(item.b64_json, "base64"));
}
