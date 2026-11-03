# 0005 — MP4 export path

**Status:** accepted (prototype) · **Stage:** 5C

- Uses WebCodecs `VideoEncoder` (H.264, `avc` length-prefixed format) and a small ISO-BMFF muxer
  (`mp4Muxer.ts`: ftyp, mdat, moov with stts/stss/stsc/stsz/stco). No server and no 30 MB wasm download.
- Support is detected **before** work starts with `VideoEncoder.isConfigSupported` across several AVC
  profiles/levels for the requested size; the dialog shows the result and disables export when unsupported.
- Alpha is never claimed: frames are flattened onto the document background (white if transparent). Dimensions are rounded to even.
- Keyframe every 2 seconds; bitrate derived from size × fps × quality.
- Verified in the Playwright suite by decoding the output in a `<video>` element (size and duration).
- ffmpeg.wasm remains the fallback option if a target browser lacks WebCodecs H.264 (Safari < 16.4).
