// Browser side of the studio. It never sees the API key: everything goes through /api/*.
const $ = (id) => document.getElementById(id);
const state = { models: {}, limits: { maxReferences: 14 }, refs: [] };

function fillSelect(select, values, keep) {
  select.replaceChildren(...values.map((value) => new Option(value, value)));
  if (values.includes(keep)) select.value = keep;
}

function onModelChange() {
  const spec = state.models[$("model").value];
  fillSelect($("ratio"), spec.ratios, $("ratio").value || "1:1");
  fillSelect($("resolution"), Object.keys(spec.prices), $("resolution").value || "1k");
  $("model-note").textContent = spec.note;
  updateEstimate();
}

function updateEstimate() {
  const spec = state.models[$("model").value];
  if (!spec) return;
  const cost = spec.prices[$("resolution").value] * Number($("n").value);
  $("estimate").textContent = `about $${cost.toFixed(3)}`;
}

function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function addRefs(blobs) {
  for (const blob of blobs) {
    if (state.refs.length >= state.limits.maxReferences) break;
    if (!/^image\/(png|jpeg|webp)$/.test(blob.type)) continue;
    state.refs.push(await readAsDataUrl(blob));
  }
  renderRefs();
}

function renderRefs() {
  $("refs").replaceChildren(...state.refs.map((src, i) => {
    const figure = document.createElement("figure");
    const img = Object.assign(document.createElement("img"), { src, alt: `reference ${i + 1}` });
    const remove = Object.assign(document.createElement("button"), { type: "button", textContent: "×", title: "remove" });
    remove.onclick = () => { state.refs.splice(i, 1); renderRefs(); };
    figure.append(img, remove);
    return figure;
  }));
  $("go").textContent = state.refs.length ? `Edit with ${state.refs.length} reference${state.refs.length > 1 ? "s" : ""}` : "Generate";
}

function card(item) {
  const div = document.createElement("div");
  div.className = "card";
  for (const file of item.files) {
    const link = Object.assign(document.createElement("a"), { href: `/gallery/${file}`, target: "_blank" });
    link.append(Object.assign(document.createElement("img"), { src: `/gallery/${file}`, loading: "lazy", alt: item.prompt }));
    const reuse = Object.assign(document.createElement("button"), { type: "button", textContent: "Use as reference" });
    reuse.onclick = async () => addRefs([await (await fetch(`/gallery/${file}`)).blob()]);
    div.append(link, reuse);
  }
  const meta = document.createElement("p");
  meta.textContent = `${item.model} · ${item.aspect_ratio} · ${item.resolution} · $${item.cost.toFixed(3)} — ${item.prompt}`;
  div.append(meta);
  return div;
}

async function loadGallery() {
  const { items, total_cost } = await (await fetch("/api/gallery")).json();
  $("gallery").replaceChildren(...items.map(card));
  $("spend").textContent = `Spent so far: $${total_cost.toFixed(2)}`;
}

$("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const started = Date.now();
  const timer = setInterval(() => { $("status").textContent = `working… ${Math.round((Date.now() - started) / 1000)} s`; }, 1000);
  $("go").disabled = true;
  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: $("model").value,
        prompt: $("prompt").value,
        aspect_ratio: $("ratio").value,
        resolution: $("resolution").value,
        n: Number($("n").value),
        references: state.refs,
      }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    $("status").textContent = `done in ${Math.round((Date.now() - started) / 1000)} s, $${body.cost.toFixed(3)}`;
    await loadGallery();
  } catch (error) {
    $("status").textContent = `failed: ${error.message}`;
  } finally {
    clearInterval(timer);
    $("go").disabled = false;
  }
});

$("model").addEventListener("change", onModelChange);
$("resolution").addEventListener("change", updateEstimate);
$("n").addEventListener("change", updateEstimate);
$("files").addEventListener("change", (event) => addRefs([...event.target.files]));
$("drop").addEventListener("dragover", (event) => event.preventDefault());
$("drop").addEventListener("drop", (event) => { event.preventDefault(); addRefs([...event.dataTransfer.files]); });

const { models, limits } = await (await fetch("/api/models")).json();
Object.assign(state, { models, limits });
$("model").replaceChildren(...Object.entries(models).map(([id, spec]) => new Option(spec.label, id)));
$("model").value = "nano-banana-2";
onModelChange();
loadGallery();
