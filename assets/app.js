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
  gpsBlock: $("gpsBlock"),
  gpsCoords: $("gpsCoords"),
  gpsGmaps: $("gpsGmaps"),
  gpsMap: $("gpsMap"),
  form: $("clipForm"),
  trickName: $("trickName"),
  riderList: $("riderList"),
  addRiderBtn: $("addRiderBtn"),
  uploaderName: $("uploaderName"),
  samePerson: $("samePerson"),
  location: $("location"),
  locationResults: $("locationResults"),
  locationMapBlock: $("locationMapBlock"),
  locationCoords: $("locationCoords"),
  locationGmaps: $("locationGmaps"),
  locationMap: $("locationMap"),
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
let clipInfo = {};    // duration / dimensions / hash / GPS read in the browser
let posterBlob = null;
let shotType = "";
let pickedSpot = null; // { name, lat, lon } when a location search result is picked

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
 *
 * PRIVACY: `record.private` holds rider contact details (emails /
 * Instagram handles) for the maintainers' bookkeeping only. It must
 * NEVER be sent to, or included in, any public dataset export —
 * strip it before anything is published.
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
    gps_lat: null,
    gps_lon: null,
  };

  els.preview.src = URL.createObjectURL(file);
  els.preview.hidden = false;
  els.picker.hidden = true;
  els.change.hidden = false;

  els.clipMeta.hidden = false;
  renderClipMeta();
  els.durationWarn.hidden = true;
  els.gpsBlock.hidden = true;
  els.gpsMap.removeAttribute("src");
  updateSubmitState();

  scanFile(file); // async; fills in clipInfo.sha256 and clipInfo.gps_* when done
}

function renderClipMeta() {
  const bits = [
    clipInfo.file_name,
    `${(clipInfo.file_size_bytes / 1e6).toFixed(1)} MB`,
    clipInfo.mime_type,
    clipInfo.duration_seconds != null ? `${clipInfo.duration_seconds}s` : null,
    clipInfo.width ? `${clipInfo.width}×${clipInfo.height}` : null,
    clipInfo.gps_lat != null ? "📍 GPS found in file" : null,
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

// One read of the file bytes does two jobs:
//  - SHA-256, via WebCrypto (needs a secure context: https — GitHub
//    Pages qualifies — or localhost).
//  - GPS: MP4/MOV files from phones and cameras often carry an ISO 6709
//    location string ("+27.1000-045.2000/") in the ©xyz atom or in
//    com.apple.quicktime.location.ISO6709. We scan the raw bytes for
//    that pattern as text; no GPS in the file just means no map.
async function scanFile(file) {
  let buf;
  try {
    buf = await file.arrayBuffer();
  } catch {
    return;
  }
  if (window.crypto && crypto.subtle) {
    try {
      const digest = await crypto.subtle.digest("SHA-256", buf);
      clipInfo.sha256 = [...new Uint8Array(digest)]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    } catch {
      clipInfo.sha256 = null;
    }
  }
  const gps = findISO6709(buf);
  if (gps && selectedFile === file) {
    clipInfo.gps_lat = gps.lat;
    clipInfo.gps_lon = gps.lon;
    showGPSMap();
    renderClipMeta();
  }
}

// ISO 6709 point location: signed decimal lat (2-digit degrees) directly
// followed by signed decimal lon (3-digit degrees), e.g. "+27.1000-045.2000/".
// Scans in chunks (metadata can sit anywhere in the file) with a small
// carry-over so a match straddling a chunk boundary isn't missed.
function findISO6709(buf) {
  const re = /([+-]\d{2}\.\d{3,})([+-]\d{3}\.\d{3,})/;
  const view = new Uint8Array(buf);
  const CHUNK = 4 * 1024 * 1024;
  const decoder = new TextDecoder("iso-8859-1");
  let carry = "";
  for (let off = 0; off < view.length; off += CHUNK) {
    const text = carry + decoder.decode(view.subarray(off, Math.min(off + CHUNK, view.length)));
    const m = text.match(re);
    if (m) {
      const lat = parseFloat(m[1]);
      const lon = parseFloat(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && (lat !== 0 || lon !== 0)) {
        return { lat, lon };
      }
    }
    carry = text.slice(-64);
  }
  return null;
}

/* ================= Maps (OpenStreetMap embeds, no API key) ================= */

function osmEmbedURL(lat, lon) {
  const d = 0.008; // ~1 km box around the point
  const bbox = [lon - d, lat - d, lon + d, lat + d].join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${lat},${lon}`;
}

function gmapsURL(lat, lon) {
  return `https://www.google.com/maps?q=${lat},${lon}`;
}

function fmtCoords(lat, lon) {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

// Builds a labelled map block for a saved clip card's Details.
function buildMapBlock(lat, lon, label) {
  const wrap = document.createElement("div");
  wrap.className = "map-block";
  const p = document.createElement("p");
  p.className = "map-label";
  p.textContent = `📍 ${label} — ${fmtCoords(lat, lon)} · `;
  const a = document.createElement("a");
  a.href = gmapsURL(lat, lon);
  a.target = "_blank";
  a.rel = "noopener";
  a.textContent = "Open in Google Maps";
  p.append(a);
  const iframe = document.createElement("iframe");
  iframe.className = "map-frame";
  iframe.loading = "lazy";
  iframe.title = `${label} map`;
  iframe.src = osmEmbedURL(lat, lon);
  wrap.append(p, iframe);
  return wrap;
}

function showGPSMap() {
  els.gpsCoords.textContent = fmtCoords(clipInfo.gps_lat, clipInfo.gps_lon);
  els.gpsGmaps.href = gmapsURL(clipInfo.gps_lat, clipInfo.gps_lon);
  els.gpsMap.src = osmEmbedURL(clipInfo.gps_lat, clipInfo.gps_lon);
  els.gpsBlock.hidden = false;
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

/* ================= Riders (repeatable rows) =================
 * Each row: a name (public metadata) and an OPTIONAL contact (email or
 * Instagram handle). Contacts are private bookkeeping only — they are
 * collected into record.private at submit time, never into the public
 * metadata, and never published.
 */

function addRiderRow() {
  const row = document.createElement("div");
  row.className = "rider-row";

  const head = document.createElement("div");
  head.className = "rider-row-head";
  const title = document.createElement("span");
  title.className = "rider-row-title";
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "rider-remove";
  remove.textContent = "Remove";
  remove.addEventListener("click", () => {
    row.remove();
    refreshRiderRows();
    syncSamePerson();
  });
  head.append(title, remove);

  const name = document.createElement("input");
  name.type = "text";
  name.className = "rider-name";
  name.placeholder = "Rider's name";
  name.autocomplete = "off";
  name.addEventListener("input", syncSamePerson);

  const contact = document.createElement("input");
  contact.type = "text";
  contact.className = "rider-contact";
  contact.placeholder = "Email or Instagram handle (optional)";
  contact.autocomplete = "off";

  const note = document.createElement("p");
  note.className = "private-note";
  note.textContent =
    "Private — never published. Just so we can keep track of who's who and whose permission we have.";

  row.append(head, name, contact, note);
  els.riderList.append(row);
  refreshRiderRows();
  return row;
}

// Number the rows ("Rider 1", "Rider 2", …) and keep at least one row:
// the remove button is disabled when only one row remains.
function refreshRiderRows() {
  const rows = els.riderList.querySelectorAll(".rider-row");
  rows.forEach((row, i) => {
    row.querySelector(".rider-row-title").textContent = `Rider ${i + 1}`;
    row.querySelector(".rider-remove").disabled = rows.length <= 1;
  });
}

els.addRiderBtn.addEventListener("click", () => addRiderRow());

// [{ name, contact }] for every row with anything filled in.
function collectRiders() {
  return Array.from(els.riderList.querySelectorAll(".rider-row"))
    .map((row) => ({
      name: row.querySelector(".rider-name").value.trim(),
      contact: row.querySelector(".rider-contact").value.trim(),
    }))
    .filter((r) => r.name || r.contact);
}

function firstRiderName() {
  const input = els.riderList.querySelector(".rider-row .rider-name");
  return input ? input.value : "";
}

// "I'm a rider" quick toggle: keep uploader in sync with the FIRST rider.
els.samePerson.addEventListener("change", syncSamePerson);
function syncSamePerson() {
  if (els.samePerson.checked) els.uploaderName.value = firstRiderName();
}

/* ================= Location search (OpenStreetMap Nominatim) =================
 * Typing searches Nominatim (debounced) and shows a results dropdown.
 * Picking a result stores its coordinates + shows a map preview. Never
 * picking one is fine: the plain typed text is saved as the location.
 */

let locationTimer = null;

els.location.addEventListener("input", () => {
  // Editing the text after picking a result un-picks it: free text wins.
  if (pickedSpot && els.location.value.trim() !== pickedSpot.name) {
    pickedSpot = null;
    els.locationMapBlock.hidden = true;
    els.locationMap.removeAttribute("src");
  }
  const q = els.location.value.trim();
  clearTimeout(locationTimer);
  if (q.length < 3) {
    hideLocationResults();
    return;
  }
  locationTimer = setTimeout(() => searchLocation(q), 350);
});

async function searchLocation(q) {
  let items;
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`,
      { headers: { Accept: "application/json" } }
    );
    if (!res.ok) return;
    items = await res.json();
  } catch {
    return; // offline etc. — free text still works
  }
  if (els.location.value.trim() !== q) return; // user kept typing
  renderLocationResults(items);
}

function renderLocationResults(items) {
  els.locationResults.replaceChildren();
  if (!items.length) {
    hideLocationResults();
    return;
  }
  for (const item of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "loc-result";
    btn.textContent = item.display_name;
    btn.addEventListener("click", () => pickLocation(item));
    els.locationResults.append(btn);
  }
  els.locationResults.hidden = false;
}

function pickLocation(item) {
  const lat = parseFloat(item.lat);
  const lon = parseFloat(item.lon);
  pickedSpot = { name: item.display_name, lat, lon };
  els.location.value = item.display_name;
  hideLocationResults();
  els.locationCoords.textContent = fmtCoords(lat, lon);
  els.locationGmaps.href = gmapsURL(lat, lon);
  els.locationMap.src = osmEmbedURL(lat, lon);
  els.locationMapBlock.hidden = false;
}

function hideLocationResults() {
  els.locationResults.hidden = true;
  els.locationResults.replaceChildren();
}

// Close the dropdown when tapping/clicking anywhere else.
document.addEventListener("click", (e) => {
  if (!e.target.closest(".loc-search")) hideLocationResults();
});

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
  const riderEntries = collectRiders();
  const record = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    saved_at: now,
    // Metadata — every field optional, all of this is public on release
    trick_name: val(els.trickName),
    riders: riderEntries.map((r) => ({ name: r.name || null })),
    uploader_name: uploaderName,
    location: val(els.location),
    location_lat: pickedSpot ? pickedSpot.lat : null,
    location_lon: pickedSpot ? pickedSpot.lon : null,
    device: resolvedDevice(),
    shot_type: shotType || null,
    caption: val(els.caption),
    wind: val(els.wind),
    kite_size: val(els.kiteSize),
    level: els.level.value || null,
    tags: val(els.tags),
    // Technical readouts computed in the browser (incl. gps_lat/gps_lon
    // extracted from the file, kept separate from the searched spot)
    ...clipInfo,
    // PRIVATE bookkeeping — rider contacts live here, NOT alongside the
    // public metadata above, and must never be published or exported.
    private: {
      rider_contacts: riderEntries
        .filter((r) => r.contact)
        .map((r) => ({ name: r.name || null, contact: r.contact })),
    },
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
  pickedSpot = null;
  for (const c of els.shotChips.querySelectorAll(".chip")) c.setAttribute("aria-checked", "false");
  els.deviceOtherField.hidden = true;
  els.preview.removeAttribute("src");
  els.preview.hidden = true;
  els.picker.hidden = false;
  els.change.hidden = true;
  els.clipMeta.hidden = true;
  els.durationWarn.hidden = true;
  els.gpsBlock.hidden = true;
  els.gpsMap.removeAttribute("src");
  els.locationMapBlock.hidden = true;
  els.locationMap.removeAttribute("src");
  hideLocationResults();
  els.riderList.replaceChildren();
  addRiderRow();
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

  const riderNames = rec.riders && rec.riders.length
    ? rec.riders.map((r) => r.name).filter(Boolean)
    : [rec.rider_name].filter(Boolean); // older records had a single rider_name
  const subBits = [riderNames.join(", "), rec.location, shotLabel(rec.shot_type)].filter(Boolean);
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
  const privateContacts = rec.private && rec.private.rider_contacts && rec.private.rider_contacts.length
    ? rec.private.rider_contacts
        .map((c) => `${c.name || "Rider"}: ${c.contact}`)
        .join(" · ")
    : null;
  const rows = [
    ["Riders", riderNames.length ? riderNames.join(", ") : null],
    ["Rider contacts (Private)", privateContacts],
    ["Uploader", rec.uploader_name],
    ["Location", rec.location],
    ["Spot coordinates", rec.location_lat != null && rec.location_lon != null ? fmtCoords(rec.location_lat, rec.location_lon) : null],
    ["GPS (from video file)", rec.gps_lat != null && rec.gps_lon != null ? fmtCoords(rec.gps_lat, rec.gps_lon) : null],
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

  // Maps live inside Details: file GPS and searched spot are separate.
  if (rec.gps_lat != null && rec.gps_lon != null) {
    details.append(buildMapBlock(rec.gps_lat, rec.gps_lon, "From the video file"));
  }
  if (rec.location_lat != null && rec.location_lon != null) {
    details.append(buildMapBlock(rec.location_lat, rec.location_lon, "Spot"));
  }

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

addRiderRow();
renderSavedClips();
updateSubmitState();
