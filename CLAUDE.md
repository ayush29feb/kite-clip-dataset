# CLAUDE.md — Kite Clip Dataset

Context for any Claude session picking up this project. The owner is
**Ayush Saraf** (GitHub `ayush29feb`). This file summarizes a long design
session from 2026-11-10; read it before changing direction.

## The vision

Build an **open, public training dataset for kitesurfing**: ~1,000 hours of
short (**5–15 second**) trick clips, each labelled with the trick name and
rich metadata.

On top of the dataset, in order:
1. Labelling tooling + small auto-labelling models with human verification.
2. Models that can **identify clips and tricks automatically**.
3. The ultimate goal: **a world model for kiting** — a generative video
   model built on this data.

## Current state (as of 2026-11-10)

- **Repo:** github.com/ayush29feb/kite-clip-dataset — README is pushed.
- **Static page (current focus):** a fully client-side upload page at the
  repo root (`index.html` + assets), to be hosted on **GitHub Pages**
  (expected URL: https://ayush29feb.github.io/kite-clip-dataset/ — note:
  Pages needs the repo public on a free plan). Everything doable in the
  browser is done in the browser: clip preview, duration/resolution
  readout, poster frame via canvas, SHA-256 via WebCrypto, metadata form,
  consent gate; submitted clips (metadata + consent record + video blob)
  are saved in **IndexedDB** so cards persist and stay playable on the
  same device. A single `saveClip()` seam is where a real upload API
  later replaces the local save.
- **A prototype also exists** as a hosted app in Ayush's Muse account
  ("Kite Clip Uploader") with a working server-side ffmpeg transcoding
  pipeline — treat it as the reference implementation for the transcode
  spec below; its code is not in this repo.
- **Parked, do not restart without Ayush asking:** the local server,
  Cloudflare deployment (he created a Cloudflare account on 2026-11-10
  and signed in with GitHub, but deployment is deferred — he plans to
  have Claude do the final push later), account/login system,
  deduplication (v2), labelling tooling.
- **Announced** on 2026-11-10 via Instagram group DM to Remy Thellier
  (@remythe), Ben Lovelady (@benjaminlovelady), and Clay Skutch Suttner
  (@claysuttner).

## Page / UX requirements (Ayush's words, paraphrased tightly)

- **Mobile-first** — most uploaders will be on their phones.
- **Partiful-style UI** (his standing preference for all his apps):
  minimal, media-forward; the clip is the hero at the top, details below
  it; once confirmed, a clip becomes a clean card with only key info on
  the card and the rest in expandable detail.
- **Metadata form is optional** — people fill in as much as they want;
  nothing in the form blocks submission. Use **dropdowns/chips where a
  field has common values, always with a free-text escape hatch**.
- No accounts / no login in v1.

## Metadata per clip

- `trick_name` — primary label (prominent first field, but optional in the form)
- `riders` — an ARRAY: a clip can have multiple riders. Each rider has a
  `name`. **Riders are separate from the uploader** (the uploader is
  often not a rider). A "same person" toggle syncs the uploader name
  with the first rider's name; store distinctly, never merged.
- `uploader_name` — person submitting; the consent record is theirs.
- `location` — spot name, SEARCHABLE in the form (OpenStreetMap
  Nominatim autocomplete); picking a result also stores `location_lat`
  / `location_lon` and shows a map preview. Free text still allowed.

## PRIVATE contacts — never published

- Each rider row also has an **optional contact** (email or Instagram
  handle), and contacts exist ONLY so Ayush can keep track of who's who
  and whose permission he has. **Contacts are never part of the public
  dataset** — store them nested under a `private` object in the record,
  never alongside the public metadata fields, and strip them from any
  export/release. The consent copy states this split in plain language:
  the clip and its details are fully public; contact information is not
  public — only the clips are.
- `device` — recording device; dropdown (GoPro, iPhone, Android phone,
  Insta360, DJI drone, Ray-Ban Meta, Other + free text). Auto-extract
  make/model from file metadata when the backend exists.
- `shot_type` — POV / Drone / Handheld / Static-tripod / Other
- `caption` (optional), `wind`, `kite_size`, `level`, `tags`
- `uploaded_at` — automatic timestamp
- `taken_at`, `gps_lat`, `gps_lon` — extracted from the video file's
  embedded metadata when present (nice-to-have; missing must never block).
  When GPS is found, the page shows it on a map (OpenStreetMap embed +
  Google Maps link), both at upload time and on the saved card.
- Technical (from transcoding): duration, resolution, fps, codec, size,
  SHA-256 checksum (already computed client-side in the static page)
- `status` — processing / ready / failed

## Consent & legal (settled design)

- **No company / legal entity.** Ayush publishes under his own name as
  dataset maintainer. The consent flow *is* the legal mechanism.
- Upload/confirm is **blocked until all four attestations are checked**
  (this is the one hard gate besides picking a clip):
  1. Uploader owns the clip or has the owner's permission to submit it.
  2. People identifiable in it (esp. the rider) have given permission,
     or the uploader otherwise has the right to share it.
  3. The clip **and its metadata — including GPS coordinates if present —
     will be released publicly** as part of the open dataset under
     **CC BY 4.0**.
  4. Uploader understands published/downloaded copies can't be fully
     recalled; takedown removes the clip from the dataset and future
     versions.
- **Store a consent record with every clip:** uploader name, timestamp,
  consent text version (`v1`). A clip without a consent record is **not
  publishable**.
- Page footer names Ayush Saraf as maintainer with takedown
  instructions. **TODO: Ayush still needs to provide the takedown
  contact email — do not invent one.**

## Transcoding spec (backend, when it lands)

Self-run **ffmpeg/ffprobe** (never per-minute services like Mux /
Cloudflare Stream / MediaConvert — too expensive at 60,000 minutes):
- Probe/validate each upload (duration, codec, dimensions, fps).
- **Master:** MP4 capped at **2K/1440p, never upscale** lower-resolution
  sources, high-quality encode (reference build used H.264 CRF 18).
- **Preview:** 720p version. **Poster:** one JPEG frame.
- Extract technical metadata incl. SHA-256.
- **Transcoding only — no transcription.** Ayush said this explicitly.

## Storage & cost model (researched 2026-11-10)

Target: 1,000 hrs ≈ 240k–720k clips (~360k at 10s avg) ≈ **10–15 TB**
(master at 20–30 Mbps + 720p proxy). Never store raw 50–100 Mbps
originals as the main copy (22–45 TB).

| Provider | Storage | Egress |
|---|---|---|
| Backblaze B2 | $6.95/TB-mo (~$70/mo at 10 TB) | free up to 3× stored/mo, then $0.01/GB; free via Cloudflare |
| Cloudflare R2 | $15/TB-mo (~$150/mo) | $0, uncapped |
| AWS S3 | $23/TB-mo (~$230/mo) | ~$0.09/GB — one full 10 TB pull ≈ +$891. Avoid. |

Chosen direction: **B2 as the disk + Cloudflare in front**, or **R2**
for one-vendor simplicity; both S3-compatible, so code stays portable.
Upload flow: browser → tiny signer API (presigned PUT/multipart URL,
secret never in the browser) → directly to the bucket → callback
verifies and queues transcoding. Metadata lives in a real DB
(Postgres/D1), not in the bucket.

**Release plan (later):** publish clean snapshots (e.g. v0.1) to
**Hugging Face Hub** as **WebDataset TAR shards (~1–5 GB each** — HF
recommends <100k files/repo, loose mp4s don't scale) + `metadata.parquet`
and a dataset card. HF PRO ($9/mo) includes 10 TB public storage. The
bucket stays the source of truth; HF is a poor ingest system (no
moderation/approval flow), so friends never upload there directly.

## Roadmap

- **v1 (now):** static GitHub Pages upload page, client-side only.
- **Next:** backend — presigned direct upload to B2/R2, metadata DB,
  ffmpeg transcoding per spec, consent records enforced server-side.
- **v2:** deduplication — exact-hash rejection via stored SHA-256 first;
  perceptual near-duplicate matching later (transcoding changes hashes,
  so near-dupes need fingerprinting). Then labelling tooling,
  auto-labelling + human verification.
- **Later:** trick/clip identification models → kiting world model.

## Working agreements

- Ayush likes terse, plain answers and proof for claims (label estimates
  as estimates).
- Design: minimal, media-forward, Partiful-style — always.
- Don't re-propose parked items (Cloudflare deploy, local server,
  accounts, dedup) until he raises them.
