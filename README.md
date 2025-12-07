# MMM-PiCameraStream

Displays your Raspberry Pi camera on MagicMirror². The module now supports three modes:

- "local" – capture still images directly from the Pi camera using rpicam-jpeg (default, recommended on a Pi)
- "snapshot" – poll a remote image URL over HTTP and display periodic snapshots
- "stream" – render an MJPEG HTTP stream directly in the browser

## Introduction

Use this module to embed the Raspberry Pi camera feed in your MagicMirror. On a Raspberry Pi with a compatible camera, the default "local" mode captures frames using `rpicam-jpeg` and updates the UI periodically without any external HTTP server. Alternatively, you can point it to an HTTP MJPEG or snapshot URL in "stream" or "snapshot" modes.

![screenshot](screenshot.png)

## Installation

```bash
cd /path/to/MagicMirror/modules
git clone <repo-url> MMM-PiCameraStream
```

Restart MagicMirror after installation.

## Hardware requirements

This module is designed for the official Raspberry Pi camera ecosystem. For most users, we recommend the Raspberry Pi Camera Module 2. It’s a safe, well-documented choice that balances quality, performance, and ease of setup.

- Camera Module 2 replaced the original camera in April 2016 and uses the Sony IMX219 8‑megapixel sensor (the original used a 5‑megapixel OmniVision OV5647).
- Captures high‑definition video and still photos; supports 1080p video (around 45 fps), high‑frame‑rate modes like 480p (around 100 fps), and still capture.
- Installs via a 15 cm ribbon cable to the Raspberry Pi’s CSI camera port and works with all Pi models that have a camera connector.
- Important for Raspberry Pi Zero / Zero 2 W: you need a special Zero camera cable. The standard ribbon cable bundled with the camera module will not fit the Zero’s smaller connector. Zero cables are inexpensive and often included with the official Pi Zero case.
- Common use cases include home security, wildlife camera traps, and general monitoring.

Notes

- Any IMX219‑based compatible camera should generally work, but the official Camera Module 2 is an easy, reliable choice with plenty of guidance online.
- Enable the camera in Raspberry Pi OS configuration and set up a streaming or snapshot endpoint (e.g., with libcamera tools, motion, or another streamer) that serves an HTTP URL. Use that URL in `config.url` for this module.

## Configuration

Add to your `config/config.js`:

```js
// Insert this object into the `modules: []` array
const moduleEntry = {
  module: "MMM-PiCameraStream",
  position: "top_center",
  config: {
    mode: "local",               // default; capture directly from the Pi camera
    width: 640,
    height: 480,
    refreshSnapshotInterval: 1000, // ms; used in local & snapshot modes
    showStatus: true,
    offlineTimeout: 8000 // ms without updates before labeling as Offline
  }
};
```

### Options

- `mode` (string): "local" | "snapshot" | "stream". Default: "local".
- `url` (string): Only used in "snapshot" or "stream" modes. For MJPEG streams use the stream endpoint; for snapshot mode use a still-image endpoint.
- `width` (number): Rendered width in pixels.
- `height` (number): Rendered height in pixels.
- `refreshSnapshotInterval` (number): Used in "local" and "snapshot" modes. In "stream" mode this option is ignored.
- `showStatus` (boolean): Show a small Online/Offline/Connecting label under the image.
- `offlineTimeout` (number): Consider the feed Offline if there’s no update within this many milliseconds.

### Local camera capture (default mode)

No external server or `camera.jpg` file is needed. The module invokes `rpicam-jpeg` directly and updates the UI with the captured JPEG.

Example config (no URL):

    {
      module: "MMM-PiCameraStream",
      position: "top_center",
      config: {
        mode: "local",
        width: 640,
        height: 480,
        refreshSnapshotInterval: 1000,
        showStatus: true,
        offlineTimeout: 8000
      }
    }

### Modes

- Local mode (default):
  - Behavior: helper invokes `rpicam-jpeg` to capture a JPEG and pushes it to the frontend as a data URL at each interval.

- Snapshot mode:
  - Behavior: helper polls the configured `url` and pushes frames to the frontend as data URLs.

- Stream mode:
  - Behavior: frontend `<img>` points directly at the MJPEG `url`.

### Status behavior

- “Connecting…” until the first successful image/stream event
- “Online” on each successful update; stays Online while updates arrive within `offlineTimeout`
- “Offline” if no update for longer than `offlineTimeout`, or when the helper emits a `STATUS: offline`

### Multiple instances
You can add multiple instances with different URLs and sizes:

```js
// Example: two instances inside your modules array
[
  {
    module: "MMM-PiCameraStream",
    position: "top_center",
    config: { url: "http://127.0.0.1:8080/camera.jpg", refreshSnapshotInterval: 1000, width: 480, height: 360 }
  },
  {
    module: "MMM-PiCameraStream",
    position: "bottom_left",
    config: { url: "http://garagepi.local:8080/snapshot.jpg", refreshSnapshotInterval: 1000, width: 400, height: 300 }
  }
]
```

### Requirements

- `rpicam-jpeg` must be installed and working (Pi 5 or compatible, camera enabled in the OS). Test with: `rpicam-jpeg -o test.jpg -t 1`.
- Running "local" mode only makes sense on a Raspberry Pi with a compatible camera.

### Compatibility
Tested with MagicMirror² >= 2.22 and Node.js >= 18.

### Troubleshooting
- If the image never appears, open the stream URL directly in a browser on the mirror to verify reachability.
- For snapshot mode, increase `offlineTimeout` (e.g., 8000–12000) and ensure the URL returns a single image (not HTML).
- Check logs: set MagicMirror `logLevel` to include `DEBUG` and look for `[MMM-PiCameraStream]` lines.

### License
MIT

## Alternative setups

- For "snapshot" or "stream" modes, provide a Raspberry Pi camera stack that exposes an HTTP MJPEG or snapshot URL (e.g. `motion`, `libcamera` + a lightweight streamer). This module does not configure those services; it only consumes the provided URL.

## Known limitations / Notes

- Continuous MJPEG streams can create sustained network load. Size your `width`/`height` appropriately.
- For access over the internet, set up HTTPS and authentication using a reverse proxy. This module does not implement security features.
- First version keeps features simple (no controls/WebRTC). Contributions welcome!

### Troubleshooting

**No image at all on the MagicMirror UI**

- Open the `config.url` directly in a browser on the Pi (or another device on the same network).
  - If you don’t see a live stream or a static image, the camera service itself is not working yet.
- Double-check that the camera is:
  - Enabled in `raspi-config` (`Interface Options` → `Camera` on older images, or the new camera stack on Bullseye/Bookworm).
  - Using the right cable (especially on Raspberry Pi Zero boards).
  - Firmly seated in both the camera and Pi connectors.

**Stream URL works in a browser, but not in MMM-PiCameraStream**

- Make sure the URL in `config.js` matches *exactly* what works in your browser (protocol, hostname, port, path).
- If you’re using snapshot mode (`refreshSnapshotInterval > 0`):
  - The URL must return a single image (e.g. JPEG), not an HTML page.
  - Try increasing `offlineTimeout` to 8000–12000 ms for slow cameras.
- Check your MagicMirror logs:
  - Start MagicMirror in a terminal and look for lines starting with `[MMM-PiCameraStream]`.
  - Errors like “HTTP 404” or “Request timeout” usually indicate a bad path or a slow/unreachable camera service.

**Image appears, but is slow or choppy**

- For MJPEG streams, reduce the camera’s resolution or frame rate in the streaming software (e.g. `motion`, `libcamera-vid`, or your chosen streamer).
- On older Raspberry Pi models:
  - Prefer lower resolutions (e.g. 720p) for smoother performance.
  - Avoid running multiple heavy modules in the same region.

**Module shows “Offline” most of the time**

- Increase `offlineTimeout` so the helper waits longer before timing out.
- Verify that your camera service doesn’t require authentication or HTTPS if you’re using a plain HTTP URL.
- If the Pi is under heavy CPU load, try:
  - Disabling other resource-heavy modules.
  - Reducing the snapshot interval (e.g. 2000–5000 ms instead of 500 ms).

If you’re still stuck, include:
- Your `MMM-PiCameraStream` config block,
- A working example URL,
- And any `[MMM-PiCameraStream]` log lines
  when opening an issue on the repository.
