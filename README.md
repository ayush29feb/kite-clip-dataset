# Kite Clip Dataset

An open training dataset for kitesurfing: a large library of short (5–15 second)
trick clips, properly labelled, built to train models on top of —
clip and trick identification first, and ultimately a world model for
kiting (a generative video model built on this data).

Dataset maintainer: Ayush Saraf (published under his own name; no company
or legal entity behind it).

## Live page

The upload page (`index.html` + `assets/`) is a fully client-side static
site — no build step, no server. Once GitHub Pages is enabled on this
repo it will be live at https://ayush29feb.github.io/kite-clip-dataset/

For now, submitted clips are stored only in the visitor's own browser
(IndexedDB, video included) so the page can be tried and reviewed; the
shared backend in the pipeline below comes later. The single
`saveClip()` function in `assets/app.js` is the seam where the real
upload API will plug in.

## What gets collected per clip

- The clip itself (5–15s, any phone/GoPro/drone format)
- Trick name (primary label)
- Rider — the person performing the trick (separate from the uploader)
- Uploader — the person submitting the clip
- Location (spot name), plus date taken and GPS extracted from the file
  when present
- Recording device (auto-extracted from file metadata when present,
  manually editable) and shot type: POV / drone / handheld / static / other
- Optional caption, wind, kite size, level, tags

## Pipeline

1. **Upload page** — friends drop a clip + metadata in the browser.
   Video bytes go directly from the browser to object storage via a
   short-lived presigned URL from a tiny signer API; they never pass
   through the web server.
2. **Consent gate** — upload is blocked until the uploader checks all
   attestations: they own the clip or have the owner's permission, the
   rider has given permission, the clip and its metadata (including GPS,
   if present) will be released publicly under **CC BY 4.0**, and they
   understand published copies can't be fully recalled (removal requests
   are honored for the dataset and future versions). A consent record
   (uploader name, timestamp, consent text version) is stored with every
   clip; a clip without one is not publishable.
3. **Transcoding** (self-run ffmpeg, no per-minute services) — probe and
   validate, then produce:
   - a master MP4 capped at 2K/1440p, never upscaled, high-quality encode
   - a 720p preview
   - a poster frame
   - technical metadata: duration, resolution, fps, codec, size, SHA-256
4. **Storage** — cheap S3-compatible object storage (Backblaze B2 or
   Cloudflare R2; both have $0/near-$0 egress, unlike S3).
5. **Release (later)** — clean, verified snapshots published to Hugging
   Face Hub as WebDataset shards + a metadata parquet, with this repo /
   bucket as the source of truth.

## Roadmap

- v1: simple upload page (no accounts), transcoding, consent, metadata
- v2: deduplication (exact-hash rejection using the stored SHA-256 first;
  perceptual near-duplicate matching later), labelling tooling,
  auto-labelling models with human verification
- Later: trick/clip identification models; a kiting world model

## Takedown

To request removal of a clip, contact the dataset maintainer, Ayush Saraf.
Removals apply to the dataset and future versions; copies already
downloaded by others can't be recalled.
