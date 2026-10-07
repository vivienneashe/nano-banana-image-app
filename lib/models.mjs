// What each Nano Banana model accepts and what one returned image costs (USD).
// Source: the provider's model pages, checked 2026-10-07. Edit here when they change.

const TEN = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9"];

export const MODELS = {
  "nano-banana-pro": {
    label: "Nano Banana Pro",
    note: "finished images; 1K, 2K and 4K cost the same",
    ratios: TEN,
    prices: { "1k": 0.03, "2k": 0.03, "4k": 0.03 },
  },
  "nano-banana-2": {
    label: "Nano Banana 2",
    note: "everyday production images; the only one with 1:4, 4:1, 1:8, 8:1",
    ratios: [...TEN, "1:4", "4:1", "1:8", "8:1"],
    prices: { "1k": 0.02, "2k": 0.02, "4k": 0.025 },
  },
  "nano-banana-2-lite": {
    label: "Nano Banana 2 Lite",
    note: "drafts and batches; 1K only",
    ratios: TEN,
    prices: { "1k": 0.01 },
  },
};

export const LIMITS = { maxImages: 4, maxReferences: 14 };

/** Returns an error message for a request the API would refuse, or null. */
export function validate({ model, prompt, aspect_ratio, resolution, n = 1, references = [] }) {
  const spec = MODELS[model];
  if (!spec) return `unknown model: ${model}`;
  if (typeof prompt !== "string" || !prompt.trim()) return "prompt is required";
  if (aspect_ratio && !spec.ratios.includes(aspect_ratio)) return `${spec.label} does not take aspect ratio ${aspect_ratio}`;
  if (resolution && !(resolution in spec.prices)) return `${spec.label} does not render ${resolution}`;
  if (!Number.isInteger(n) || n < 1 || n > LIMITS.maxImages) return `n must be 1-${LIMITS.maxImages}`;
  if (!Array.isArray(references) || references.length > LIMITS.maxReferences) {
    return `at most ${LIMITS.maxReferences} reference images`;
  }
  if (references.some((ref) => typeof ref !== "string" || !/^data:image\/(png|jpeg|webp);base64,/.test(ref))) {
    return "references must be PNG, JPEG or WebP data URLs";
  }
  return null;
}

/** Every returned image is billed at its model and tier. */
export function costOf(model, resolution = "1k", images = 1) {
  return Math.round(MODELS[model].prices[resolution] * images * 10000) / 10000;
}
