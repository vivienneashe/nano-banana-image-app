# Image request boundary

`nano-banana-pro` uses `/v1/images/generations`. Keep the prompt, target pixel size, and requested result count explicit. The model page is authoritative for image editing fields and reference-image limits.

```json
{
  "model": "nano-banana-pro",
  "prompt": "square 1:1 editorial illustration with a clear subject",
  "size": "1024x1024",
  "n": 1
}
```

For edits, use the documented edit route and multipart fields from the model page; do not guess a reference-image field from another model. Every returned image is a billable result, so treat `n` as a cost and response-size decision.
