/* Kite Clip Dataset — upload page logic.
 *
 * Fully client-side for now: no build step, no dependencies, no server.
 * Submitted clips are saved in this browser's IndexedDB (video blob
 * included) so the cards below stay playable on the same device.
 *
 * >>> BACKEND SEAM <<<
 * When the real dataset backend lands, replace the body of saveClip()
 * (and loadClips()/deleteClip()) with calls to the upload API:
 *   1. POST the metadata + consent record to create a clip
 *   2. PUT the file to the returned upload URL
 *   3. POST complete, then list clips from the API
 * Everything above saveClip() — form, consent gate, in-browser probing —
 * stays exactly as it is.
 */
"use strict";

const CONSENT_VERSION = "v1";
const DB_NAME = "kite-clip-dataset";
const DB_STORE = "clips";

const $ = (id) => document.getElementById(id);

const els = {
  stage: $("clipStage"),
  fileInput: $("fileInput"),
  picker: $("clipPicker"),
  preview: $("clipPreview"),
  change: $("clipChange"),
  clipMeta: $("clipMeta"),
  durationWarn: $("durationWarn"),
  form: $("clipForm"),
  trickName: $("trickName"),
  riderName: $("riderName"),
  uploaderName: $("uploaderName"),
  samePerson: $("samePerson"),
  location: $("location"),
  deviceSelect: $("deviceSelect"),
  deviceOtherField: $("deviceOtherField"),
  deviceOther: $("deviceOther"),
  shotChips: $("shotChips"),
  caption: $("caption"),
  wind: $("wind"),
  kiteSize: $("kiteSize"),
  level: $("level"),
  tags: $("tags"),
  consentBoxes: Array.from(document.querySelectorAll(".consent-box")),
  submit: $("submitBtn"),
  status: $("formStatus"),
  clipGrid: $("clipGrid"),
  emptyNote: $("emptyNote"),
};

let selectedFile = null;
let clipInfo = {};    // duration / dimensions / hash read in the browser
let posterBlob = null;
let shotType = "";

/* ================= IndexedDB (current persistence layer) ================= */

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(DB_STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(DB_STORE).objectStore(DB_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ================= The save seam =================
 * saveClip(record) is the ONE function a real backend replaces.
 * `record` carries every metadata field, the consent record, the
 * technical readouts, and (for now) the video + poster blobs.
 */
async function saveClip(record) {
  // TODO(backend): POST record (minus blobs) to the upload API, PUT the
  // file to the returned URL, POST complete — then drop the line below.
  await idbPut(record);
}

async function loadClipRecords() {
  // TODO(backend): GET the clip list from the API instead.
  const all = await idbAll();
  return all.sort((a, b) => (a.saved_at < b.saved_at ? 1 : -1));
}

async function deleteClipRecord(id) {
  // TODO(backend): DELETE via the API instead.
  await idbDelete(id);
}

/* ================= File picking & in-browser probing ================= */

els.picker.addEventListener("click", () => els.fileInput.click());
els.change.addEventListener("click", () => els.fileInput.click());
els.fileInput.addEventListener("change", () => {
  if (els.fileInput.files[0]) setFile(els.fileInput.files[0]);
});

for (const evt of ["dragover", "dragenter"]) {
  els.stage.addEventListener(evt, (e) => {
    e.preventDefault();
    els.stage.classList.add("dragover");
  });
}
for (const evt of ["dragleave", "drop"]) {
  els.stage.addEventListener(evt, (e) => {
    e.preventDefault();
    els.stage.classList.remove("dragover");
  });
}
els.stage.addEventListener("drop", (e) => {
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) setFile(f);
});

function setFile(file) {
  selectedFile = file;
  posterBlob = null;
  clipInfo = {
    file_name: file.name,
    file_size_bytes: file.size,
    mime_type: file.type || null,
    file_last_modified: file.lastModified ? new Date(file.lastModified).toISOString() : null,
    duration_seconds: null,
    width: null,
    height: null,
    sha256: null,
  };

  els.preview.src = URL.createObjectURL(file);
  els.preview.hidden = false;
  els.picker.hidden = true;
  els.change.hidden = false;

  els.clipMeta.hidden = false;
  renderClipMeta();
  els.durationWarn.hidden = true;
  updateSubmitState();

  hashFile(file); // async; fills in clipInfo.sha256 when done
}

function renderClipMeta() {
  const bits = [
    clipInfo.file_name,
    `${(clipInfo.file_size_bytes / 1e6).toFixed(1)} MB`,
    clipInfo.mime_type,
    clipInfo.duration_seconds != null ? `${clipInfo.duration_seconds}s` : null,
    clipInfo.width ? `${clipInfo.width}×${clipInfo.height}` : null,
  ].filter(Boolean);
  els.clipMeta.textContent = bits.join(" · ");
}

// Duration + dimensions are readable once the browser has loaded metadata.
els.preview.addEventListener("loadedmetadata", () => {
  const d = els.preview.duration;
  if (Number.isFinite(d)) {
    clipInfo.duration_seconds = Math.round(d * 10) / 10;
    if (d < 5 || d > 15) {
      els.durationWarn.hidden = false;
      els.durationWarn.textContent =
        `Heads up: this clip is ${clipInfo.duration_seconds}s long. ` +
        `The dataset targets 5–15s clips — you can still save it, ` +
        `but shorter clips are much more useful.`;
    }
  }
  if (els.preview.videoWidth) {
    clipInfo.width = els.preview.videoWidth;
    clipInfo.height = els.preview.videoHeight;
  }
  renderClipMeta();
  capturePoster();
});

// Poster frame: grab a frame via <canvas> once the video can seek.
function capturePoster() {
  const v = els.preview;
  if (!v.videoWidth) return;
  const target = Math.min(0.6, (clipInfo.duration_seconds || 1) / 2);
  const onSeeked = () => {
    v.removeEventListener("seeked", onSeeked);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = v.videoWidth;
      canvas.height = v.videoHeight;
      canvas.getContext("2d").drawImage(v, 0, 0);
      canvas.toBlob((blob) => { posterBlob = blob; }, "image/jpeg", 0.85);
    } catch {
      posterBlob = null; // some formats/browsers refuse canvas capture — fine
    }
  };
  v.addEventListener("seeked", onSeeked);
  try {
    v.currentTime = target;
  } catch {
    v.removeEventListener("seeked", onSeeked);
  }
}

// SHA-256 of the file, via WebCrypto (needs a secure context:
// https — GitHub Pages qualifies — or localhost).
async function hashFile(file) {
  if (!window.crypto || !crypto.subtle) return;
  try {
    const buf = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buf);
    clipInfo.sha256 = [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    clipInfo.sha256 = null;
  }
}

/* ================= Form helpers ================= */

els.deviceSelect.addEventListener("change", () => {
  els.deviceOtherField.hidden = els.deviceSelect.value !== "__other";
});

els.shotChips.addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  const wasSelected = chip.getAttribute("aria-checked") === "true";
  for (const c of els.shotChips.querySelectorAll(".chip")) {
    c.setAttribute("aria-checked", "false");
  }
  shotType = wasSelected ? "" : chip.dataset.value;
  if (!wasSelected) chip.setAttribute("aria-checked", "true");
});

// "I'm the rider" quick toggle: keep uploader in sync with rider.
els.samePerson.addEventListener("change", syncSamePerson);
els.riderName.addEventListener("input", syncSamePerson);
function syncSamePerson() {
  if (els.samePerson.checked) els.uploaderName.value = els.riderName.value;
}

function resolvedDevice() {
  if (els.deviceSelect.value === "__other") return els.deviceOther.value.trim() || null;
  return els.deviceSelect.value || null;
}

function allConsentChecked() {
  return els.consentBoxes.every((b) => b.checked);
}
for (const b of els.consentBoxes) b.addEventListener("change", updateSubmitState);

function updateSubmitState() {
  els.submit.disabled = !(selectedFile && allConsentChecked());
}

function setStatus(msg, kind) {
  els.status.textContent = msg;
  els.status.className = "status" + (kind ? " " + kind : "");
}

const val = (el) => el.value.trim() || null;

/* ================= Submit ================= */

els.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!selectedFile || !allConsentChecked()) return;

  els.submit.disabled = true;
  setStatus("Saving…");

  const now = new Date().toISOString();
  const uploaderName = val(els.uploaderName);
  const record = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    saved_at: now,
    // Metadata — every field optional
    trick_name: val(els.trickName),
    rider_name: val(els.riderName),
    uploader_name: uploaderName,
    location: val(els.location),
    device: resolvedDevice(),
    shot_type: shotType || null,
    caption: val(els.caption),
    wind: val(els.wind),
    kite_size: val(els.kiteSize),
    level: els.level.value || null,
    tags: val(els.tags),
    // Technical readouts computed in the browser
    ...clipInfo,
    // Consent record — the clip is publishable only because this exists
    consent: {
      rights: $("consentRights").checked,
      rider_permission: $("consentRider").checked,
      license_cc_by: $("consentLicense").checked,
      no_recall: $("consentRecall").checked,
      uploader_name: uploaderName,
      consented_at: now,
      consent_version: CONSENT_VERSION,
    },
    video_blob: selectedFile,
    poster_blob: posterBlob,
  };

  try {
    await saveClip(record);
    setStatus("Saved — thank you! Your clip is in the list below.", "ok");
    resetForm();
    await renderSavedClips();
  } catch (err) {
    console.error(err);
    setStatus("Couldn't save in this browser — storage may be full or blocked.", "error");
    updateSubmitState();
  }
});

function resetForm() {
  els.form.reset();
  selectedFile = null;
  clipInfo = {};
  posterBlob = null;
  shotType = "";
  for (const c of els.shotChips.querySelectorAll(".chip")) c.setAttribute("aria-checked", "false");
  els.deviceOtherField.hidden = true;
  els.preview.removeAttribute("src");
  els.preview.hidden = true;
  els.picker.hidden = false;
  els.change.hidden = true;
  els.clipMeta.hidden = true;
  els.durationWarn.hidden = true;
  updateSubmitState();
}

/* ================= Saved clip cards ================= */

let liveObjectURLs = [];
function trackURL(url) {
  liveObjectURLs.push(url);
  return url;
}

async function renderSavedClips() {
  for (const u of liveObjectURLs) URL.revokeObjectURL(u);
  liveObjectURLs = [];

  let records;
  try {
    records = await loadClipRecords();
  } catch (err) {
    console.error(err);
    els.emptyNote.textContent = "Couldn't read saved clips from this browser.";
    return;
  }

  els.clipGrid.replaceChildren();
  if (!records.length) {
    const p = document.createElement("p");
    p.className = "empty-note";
    p.textContent = "No clips saved yet — yours could be the first.";
    els.clipGrid.append(p);
    return;
  }
  for (const rec of records) els.clipGrid.append(clipCard(rec));
}

function clipCard(rec) {
  const card = document.createElement("article");
  card.className = "card clip-card";

  // Media: the stored video itself, with the captured poster frame.
  const media = document.createElement("div");
  media.className = "clip-card-media";
  const video = document.createElement("video");
  video.controls = true;
  video.playsInline = true;
  video.preload = "metadata";
  if (rec.video_blob) video.src = trackURL(URL.createObjectURL(rec.video_blob));
  if (rec.poster_blob) video.poster = trackURL(URL.createObjectURL(rec.poster_blob));
  media.append(video);
  card.append(media);

  const body = document.createElement("div");
  body.className = "clip-card-body";

  const title = document.createElement("h3");
  title.className = "clip-card-title";
  title.textContent = rec.trick_name || "Untitled clip";
  body.append(title);

  const subBits = [rec.rider_name, rec.location, shotLabel(rec.shot_type)].filter(Boolean);
  if (subBits.length) {
    const sub = document.createElement("p");
    sub.className = "clip-card-sub";
    sub.textContent = subBits.join(" · ");
    body.append(sub);
  }
  if (rec.caption) {
    const cap = document.createElement("p");
    cap.className = "clip-card-sub";
    cap.textContent = rec.caption;
    body.append(cap);
  }

  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "Details";
  details.append(summary);
  const dl = document.createElement("dl");
  const rows = [
    ["Rider", rec.rider_name],
    ["Uploader", rec.uploader_name],
    ["Location", rec.location],
    ["Device", rec.device],
    ["Shot type", shotLabel(rec.shot_type)],
    ["Wind", rec.wind],
    ["Kite size", rec.kite_size],
    ["Level", rec.level],
    ["Tags", rec.tags],
    ["Duration", rec.duration_seconds != null ? `${rec.duration_seconds}s` : null],
    ["Resolution", rec.width && rec.height ? `${rec.width}×${rec.height}` : null],
    ["File", rec.file_name],
    ["Size", rec.file_size_bytes != null ? `${(rec.file_size_bytes / 1e6).toFixed(1)} MB` : null],
    ["SHA-256", rec.sha256 ? `${rec.sha256.slice(0, 16)}…` : null],
    ["Saved", rec.saved_at ? new Date(rec.saved_at).toLocaleString() : null],
    ["Consent", rec.consent ? `v${rec.consent.consent_version.replace(/^v/, "")} · by ${rec.consent.uploader_name || "uploader"}` : null],
  ];
  for (const [k, v] of rows) {
    if (v == null || v === "") continue;
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = v;
    dl.append(dt, dd);
  }
  details.append(dl);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "clip-remove";
  remove.textContent = "Remove from this browser";
  remove.addEventListener("click", async () => {
    await deleteClipRecord(rec.id);
    await renderSavedClips();
  });
  details.append(remove);

  body.append(details);
  card.append(body);
  return card;
}

function shotLabel(v) {
  return { pov: "POV", drone: "Drone", handheld: "Handheld", static: "Static / tripod", other: "Other" }[v] || v;
}

/* ================= Init ================= */

renderSavedClips();
updateSubmitState();
