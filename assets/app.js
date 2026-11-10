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
  trickPills: $("trickPills"),
  riderList: $("riderList"),
  addRiderBtn: $("addRiderBtn"),
  uploaderName: $("uploaderName"),
  uploaderContact: $("uploaderContact"),
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
let deviceFromFile = false; // device field was auto-filled from the file's tags
let deviceTouched = false;  // user picked/typed a device themselves

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
    taken_at: null,
    device_make: null,
    device_model: null,
    software: null,
    rotation: null,
    orientation: null,
  };
  deviceFromFile = false;
  deviceTouched = false;

  els.preview.src = URL.createObjectURL(file);
  els.preview.hidden = false;
  els.picker.hidden = true;
  els.change.hidden = false;

  els.clipMeta.hidden = false;
  renderClipMeta();
  openRowOnly("trick"); // the trick name is the one label that matters most
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
    clipInfo.taken_at
      ? `Taken ${new Date(clipInfo.taken_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
      : null,
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
    refreshSummaries(); // reflect the GPS in the Spot row right away
  }

  // Whatever else the file's own metadata offers: taken date, camera
  // make/model, encoder software, orientation. All best-effort.
  if (selectedFile === file) {
    const meta = parseMp4Metadata(buf);
    if (meta.taken_at) clipInfo.taken_at = meta.taken_at;
    if (meta.device_make) clipInfo.device_make = meta.device_make;
    if (meta.device_model) clipInfo.device_model = meta.device_model;
    if (meta.software) clipInfo.software = meta.software;
    if (meta.rotation != null) clipInfo.rotation = meta.rotation;
    if (meta.orientation) clipInfo.orientation = meta.orientation;
    if (meta.taken_at) renderClipMeta();
    if (meta.device_make || meta.device_model) applyDevicePrefill(meta);
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

/* ================= MP4/MOV metadata parser =================
 * A small defensive box/atom walker: reads mvhd (creation time), tkhd
 * (track size + rotation matrix), and the meta/keys/ilst + udta tags
 * (QuickTime make/model/software/creationdate, ©day/©mod/©too).
 * Everything is bounds-checked and wrapped in try/catch — a weird file
 * yields nulls, never an exception, and nothing here can block saving.
 */
function parseMp4Metadata(buf) {
  const meta = {
    taken_at: null,
    device_make: null,
    device_model: null,
    software: null,
    rotation: null,
    orientation: null,
  };
  try {
    const dv = new DataView(buf);
    const end = buf.byteLength;
    const utf8 = new TextDecoder("utf-8");
    const MAC_EPOCH = 2082844800; // seconds between 1904 and 1970
    let metaKeys = [];
    let mvhdISO = null;
    let creationdateStr = null;
    let dayStr = null;
    let tkhdDone = false;

    const typeAt = (o) =>
      String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));

    function boxHeader(off, limit) {
      if (off + 8 > limit) return null;
      let size = dv.getUint32(off);
      const type = typeAt(off + 4);
      let header = 8;
      if (size === 1) {
        if (off + 16 > limit) return null;
        size = Number(dv.getBigUint64(off + 8));
        header = 16;
      } else if (size === 0) {
        size = limit - off;
      }
      if (size < header || off + size > limit) return null;
      return { type, content: off + header, end: off + size };
    }

    function cleanText(bytes) {
      try {
        return utf8
          .decode(bytes)
          .replace(/[\u0000-\u001f]+/g, " ")
          .trim()
          .slice(0, 200) || null;
      } catch {
        return null;
      }
    }

    // Value of a metadata item box: the inner 'data' box (skipping its
    // type+locale header) when present, else the raw box text.
    function itemText(box) {
      let off = box.content;
      while (off < box.end) {
        const sub = boxHeader(off, box.end);
        if (!sub) break;
        if (sub.type === "data" && sub.end - sub.content > 8) {
          return cleanText(new Uint8Array(buf, sub.content + 8, sub.end - sub.content - 8));
        }
        off = sub.end;
      }
      return cleanText(new Uint8Array(buf, box.content, box.end - box.content));
    }

    function assignTag(key, value) {
      if (!key || !value) return;
      if (key === "©day" || key.endsWith(".creationdate")) {
        if (!creationdateStr && key !== "©day") creationdateStr = value;
        if (key === "©day" && !dayStr) dayStr = value;
      } else if (key === "©mod" || key.endsWith(".model")) {
        if (!meta.device_model) meta.device_model = value;
      } else if (key.endsWith(".make")) {
        if (!meta.device_make) meta.device_make = value;
      } else if (key === "©too" || key.endsWith(".software")) {
        if (!meta.software) meta.software = value;
      }
    }

    function parseKeys(box) {
      metaKeys = [];
      if (box.content + 8 > box.end) return;
      const count = dv.getUint32(box.content + 4);
      let off = box.content + 8;
      for (let i = 0; i < count && off < box.end; i++) {
        const entry = boxHeader(off, box.end);
        if (!entry) break;
        metaKeys.push(cleanText(new Uint8Array(buf, entry.content + 4, entry.end - entry.content - 4)) || "");
        off = entry.end;
      }
    }

    function parseIlst(box) {
      let off = box.content;
      while (off < box.end) {
        const item = boxHeader(off, box.end);
        if (!item) break;
        let key = null;
        if (item.type === "©day" || item.type === "©mod" || item.type === "©too" || item.type === "©nam") {
          key = item.type;
        } else {
          const idx = dv.getUint32(off + 4); // item type bytes ARE the 1-based key index
          if (idx >= 1 && idx <= metaKeys.length) key = metaKeys[idx - 1];
        }
        if (key) assignTag(key, itemText(item));
        off = item.end;
      }
    }

    function parseUdta(box) {
      let off = box.content;
      while (off < box.end) {
        const child = boxHeader(off, box.end);
        if (!child) break;
        if (child.type === "meta") walk(child.content + 4, child.end, 3);
        else if (child.type === "©day" || child.type === "©mod" || child.type === "©too") {
          assignTag(child.type, itemText(child));
        }
        off = child.end;
      }
    }

    function parseMvhd(box) {
      const v = dv.getUint8(box.content);
      let unix = null;
      if (v === 1 && box.content + 12 <= box.end) {
        unix = Number(dv.getBigUint64(box.content + 4)) - MAC_EPOCH;
      } else if (v === 0 && box.content + 8 <= box.end) {
        unix = dv.getUint32(box.content + 4) - MAC_EPOCH;
      }
      if (unix != null && unix > 946684800 && unix < 4102444800) {
        mvhdISO = new Date(unix * 1000).toISOString();
      }
    }

    function parseTkhd(box) {
      if (tkhdDone) return;
      const v = dv.getUint8(box.content);
      const mOff = v === 1 ? box.content + 52 : box.content + 40;
      const wOff = v === 1 ? box.content + 88 : box.content + 76;
      if (wOff + 8 > box.end) return;
      const w = dv.getUint32(wOff) / 65536;
      const h = dv.getUint32(wOff + 4) / 65536;
      if (!w || !h) return;
      tkhdDone = true;
      const a = dv.getInt32(mOff) / 65536;
      const b = dv.getInt32(mOff + 4) / 65536;
      const rot = ((Math.round((Math.atan2(b, a) * 180) / Math.PI) % 360) + 360) % 360;
      meta.rotation = rot;
      const effW = rot === 90 || rot === 270 ? h : w;
      const effH = rot === 90 || rot === 270 ? w : h;
      meta.orientation = effH > effW ? "portrait" : "landscape";
    }

    function walk(start, limit, depth) {
      if (depth > 6) return;
      let off = start;
      while (off < limit) {
        const box = boxHeader(off, limit);
        if (!box) break;
        if (box.type === "moov" || box.type === "trak" || box.type === "mdia") {
          walk(box.content, box.end, depth + 1);
        } else if (box.type === "meta") {
          walk(box.content + 4, box.end, depth + 1); // skip version/flags
        } else if (box.type === "udta") {
          parseUdta(box);
        } else if (box.type === "mvhd") {
          parseMvhd(box);
        } else if (box.type === "tkhd") {
          parseTkhd(box);
        } else if (box.type === "keys") {
          parseKeys(box);
        } else if (box.type === "ilst") {
          parseIlst(box);
        }
        off = box.end;
      }
    }

    walk(0, end, 0);

    // Taken date priority: QuickTime creationdate (carries a timezone),
    // then mvhd creation time, then a ©day tag (date-length strings only,
    // a bare year is not a taken date).
    const candidates = [
      { v: creationdateStr, minLen: 0 },
      { v: mvhdISO, minLen: 0 },
      { v: dayStr, minLen: 8 }, // a bare "2024" is not a taken date
    ];
    for (const { v, minLen } of candidates) {
      if (!v || v.trim().length < minLen) continue;
      const t = Date.parse(v);
      if (!Number.isNaN(t) && t > 946684800000 && t < 4102444800000) {
        meta.taken_at = new Date(t).toISOString();
        break;
      }
    }
  } catch {
    /* metadata is a bonus — stay silent */
  }
  return meta;
}

// Auto-fill the Device field from the file's make/model tags, but only
// while the user hasn't picked or typed a device themselves. Known
// families snap to the matching dropdown option; anything else lands
// in the "Other" free-text with the full make + model.
function applyDevicePrefill(meta) {
  if (deviceTouched || resolvedDevice()) return;
  const make = (meta.device_make || "").trim();
  const model = (meta.device_model || "").trim();
  if (!make && !model) return;
  const label =
    make && model && model.toLowerCase().includes(make.toLowerCase())
      ? model
      : [make, model].filter(Boolean).join(" ");
  const hay = label.toLowerCase();
  let option = null;
  if (hay.includes("gopro")) option = "GoPro";
  else if (hay.includes("iphone")) option = "iPhone";
  else if (hay.includes("insta360")) option = "Insta360";
  else if (hay.includes("dji")) option = "DJI drone";
  if (option) {
    els.deviceSelect.value = option;
    els.deviceOtherField.hidden = true;
  } else {
    els.deviceSelect.value = "__other";
    els.deviceOtherField.hidden = false;
    els.deviceOther.value = label;
  }
  deviceFromFile = true;
  refreshSummaries();
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

/* ================= Summary rows & accordion editors =================
 * The metadata area is a live summary card: each row shows its value as
 * final info (chips / clean text, or a muted "+ Add" pill when empty),
 * and tapping the row expands only that row's editor inline. Opening one
 * row collapses the others; choosing a value collapses back to summary.
 */

const metaRows = {};   // name -> { row, head }
const summaryEls = {}; // name -> .meta-values element
document.querySelectorAll(".meta-row").forEach((rowEl) => {
  const name = rowEl.dataset.row;
  metaRows[name] = { row: rowEl, head: rowEl.querySelector(".meta-head") };
  metaRows[name].head.addEventListener("click", () => toggleRow(name));
});
document.querySelectorAll("[data-summary]").forEach((el) => {
  summaryEls[el.dataset.summary] = el;
});

function setRow(name, open) {
  const r = metaRows[name];
  if (!r) return;
  r.row.classList.toggle("open", open);
  r.head.setAttribute("aria-expanded", String(open));
}
function toggleRow(name) {
  const wasOpen = metaRows[name].row.classList.contains("open");
  closeAllRows();
  if (!wasOpen) setRow(name, true);
}
function openRowOnly(name) {
  closeAllRows();
  setRow(name, true);
}
function closeRow(name) {
  setRow(name, false);
}
function closeAllRows() {
  for (const name of Object.keys(metaRows)) setRow(name, false);
}

// Renders one row's summary: value chips and/or a plain-text value, or
// the muted "+ Add" pill when the row is empty. Contacts (private) are
// never passed here — summaries mirror the public final card.
function renderSummary(name, chips, plain) {
  const box = summaryEls[name];
  if (!box) return;
  box.replaceChildren();
  if (!chips.length && !plain) {
    const s = document.createElement("span");
    s.className = "meta-add";
    s.textContent = "+ Add";
    box.append(s);
    return;
  }
  for (const c of chips) {
    const s = document.createElement("span");
    s.className = "meta-chip";
    s.textContent = c;
    box.append(s);
  }
  if (plain) {
    const s = document.createElement("span");
    s.className = "meta-plain";
    s.textContent = plain;
    box.append(s);
  }
}

function refreshSummaries() {
  const trick = els.trickName.value.trim();
  renderSummary("trick", trick ? [trick] : [], null);
  for (const pill of els.trickPills.querySelectorAll(".trick-pill")) {
    pill.classList.toggle("on", pill.dataset.trick === trick);
  }

  const riderNames = collectRiders().map((r) => r.name).filter(Boolean);
  renderSummary("riders", riderNames, null);

  // Spot: typed/picked spot wins; otherwise surface the file's own GPS
  // in the row so the auto-detected location is visible on the card.
  const spotText = val(els.location);
  if (spotText) {
    renderSummary("spot", [], spotText);
  } else if (clipInfo.gps_lat != null && clipInfo.gps_lon != null) {
    renderSummary("spot", [`📍 ${fmtCoords(clipInfo.gps_lat, clipInfo.gps_lon)}`], null);
    const hint = document.createElement("span");
    hint.className = "meta-fromfile";
    hint.textContent = "from your file — tap to name the spot";
    summaryEls.spot.append(hint);
  } else {
    renderSummary("spot", [], null);
  }
  renderSummary("shot", shotType ? [shotLabel(shotType)] : [], null);

  const dev = resolvedDevice();
  renderSummary("device", dev ? [dev] : [], null);
  if (dev && deviceFromFile && !deviceTouched) {
    const hint = document.createElement("span");
    hint.className = "meta-fromfile";
    hint.textContent = "from your file";
    summaryEls.device.append(hint);
  }

  renderSummary("wind", [], val(els.wind));
  renderSummary("kite", [], val(els.kiteSize));
  renderSummary("level", els.level.value ? [els.level.value] : [], null);

  const tagList = (val(els.tags) || "").split(",").map((t) => t.trim()).filter(Boolean);
  renderSummary("caption", tagList, val(els.caption));

  renderSummary("uploader", [], val(els.uploaderName));
}

// Enter inside a single-line editor means "done": collapse to summary.
function collapseOnEnter(input, rowName) {
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      closeRow(rowName);
      input.blur();
    }
  });
}

/* ================= Form helpers ================= */

els.trickName.addEventListener("input", refreshSummaries);
collapseOnEnter(els.trickName, "trick");

// Trick pills: tap instead of typing. Sets the input, collapses the row.
els.trickPills.addEventListener("click", (e) => {
  const pill = e.target.closest(".trick-pill");
  if (!pill) return;
  els.trickName.value = pill.dataset.trick;
  refreshSummaries();
  closeRow("trick");
});

els.deviceSelect.addEventListener("change", () => {
  deviceTouched = true;
  els.deviceOtherField.hidden = els.deviceSelect.value !== "__other";
  refreshSummaries();
  // A concrete pick is final; "Other…" stays open for the free text.
  if (els.deviceSelect.value && els.deviceSelect.value !== "__other") closeRow("device");
});
els.deviceOther.addEventListener("input", () => {
  deviceTouched = true;
  refreshSummaries();
});
collapseOnEnter(els.deviceOther, "device");

els.shotChips.addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  const wasSelected = chip.getAttribute("aria-checked") === "true";
  for (const c of els.shotChips.querySelectorAll(".chip")) {
    c.setAttribute("aria-checked", "false");
  }
  shotType = wasSelected ? "" : chip.dataset.value;
  if (!wasSelected) chip.setAttribute("aria-checked", "true");
  refreshSummaries();
  if (shotType) closeRow("shot");
});

els.wind.addEventListener("input", refreshSummaries);
els.kiteSize.addEventListener("input", refreshSummaries);
els.caption.addEventListener("input", refreshSummaries);
els.tags.addEventListener("input", refreshSummaries);
els.uploaderName.addEventListener("input", refreshSummaries);
collapseOnEnter(els.wind, "wind");
collapseOnEnter(els.kiteSize, "kite");
collapseOnEnter(els.uploaderName, "uploader");

els.level.addEventListener("change", () => {
  refreshSummaries();
  if (els.level.value) closeRow("level");
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
    refreshSummaries();
  });
  head.append(title, remove);

  const name = document.createElement("input");
  name.type = "text";
  name.className = "rider-name";
  name.placeholder = "Rider's name";
  name.autocomplete = "off";
  name.addEventListener("input", () => {
    syncSamePerson();
    refreshSummaries();
  });

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
  refreshSummaries();
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
  if (els.samePerson.checked) {
    els.uploaderName.value = firstRiderName();
    refreshSummaries();
  }
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
  refreshSummaries();
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
  refreshSummaries();
  // The editor stays open here on purpose: the map that just appeared
  // below the row is the confirmation of the pick.
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
      uploader_contact: val(els.uploaderContact),
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
  deviceFromFile = false;
  deviceTouched = false;
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
  closeAllRows();
  refreshSummaries();
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
    ["Uploader contact (Private)", rec.private && rec.private.uploader_contact ? rec.private.uploader_contact : null],
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
    ["Taken", rec.taken_at ? new Date(rec.taken_at).toLocaleString() : null],
    ["Device (from file)", [rec.device_make, rec.device_model].filter(Boolean).join(" ") || null],
    ["Software", rec.software],
    ["Orientation", rec.orientation
      ? rec.orientation[0].toUpperCase() + rec.orientation.slice(1) + (rec.rotation ? ` · rotated ${rec.rotation}°` : "")
      : null],
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
refreshSummaries();
renderSavedClips();
updateSubmitState();
