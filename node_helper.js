const NodeHelper = require("node_helper");
const Log = require("logger");
const http = require("http");
const https = require("https");
const { execFile } = require("child_process");

const DEFAULT_TIMEOUT_MS = 5000;

function fetchBuffer (url, timeoutMs = DEFAULT_TIMEOUT_MS) {
  // Prefer global fetch if available (Node 18+), fallback to http/https
  if (typeof fetch === "function") {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const contentType = res.headers.get("content-type") || "application/octet-stream";
        const arrayBuffer = await res.arrayBuffer();
        clearTimeout(id);
        return { buffer: Buffer.from(arrayBuffer), contentType };
      });
  }
  return new Promise((resolve, reject) => {
    const agent = url.startsWith("https:") ? https : http;
    const req = agent.get(url, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error(`HTTP ${res.statusCode}`));
        res.resume();
        return;
      }
      const chunks = [];
      res.on("data", (d) => chunks.push(d));
      res.on("end", () => {
        const buffer = Buffer.concat(chunks);
        const contentType = res.headers["content-type"] || "application/octet-stream";
        resolve({ buffer, contentType });
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("Request timeout"));
    });
    req.on("error", (err) => reject(err));
  });
}

function captureLocalSnapshot (config, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const args = [
      "--nopreview", // prevent preview window from appearing (headless capture)
      "-o", "-", // write JPEG to stdout
      "-t", "1", // minimal capture time, 1 ms
      "--width", String(config.width || 640),
      "--height", String(config.height || 480)
    ];

    const child = execFile(
      "rpicam-jpeg",
      args,
      { encoding: "buffer", maxBuffer: 5 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        if (!stdout || stdout.length === 0) {
          reject(new Error("Empty image from rpicam-jpeg"));
          return;
        }
        resolve({ buffer: stdout, contentType: "image/jpeg" });
      }
    );

    const timer = setTimeout(() => {
      // attempt to terminate the process on timeout
      child.kill("SIGTERM");
      reject(new Error("rpicam-jpeg timeout"));
    }, timeoutMs);

    child.on("exit", () => {
      clearTimeout(timer);
    });
  });
}

module.exports = NodeHelper.create({
  start () {
    this.instances = new Map(); // identifier -> { config, timer, paused, lastErrorAt, inProgress }
    Log.info("[MMM-PiCameraStream] helper started.");
  },

  stop () {
    // Clear all timers
    for (const [id, data] of this.instances.entries()) {
      if (data.timer) clearTimeout(data.timer);
    }
    this.instances.clear();
  },

  socketNotificationReceived (notification, payload) {
    if (notification === "CONFIG" && payload && payload.identifier) {
      const { identifier, config } = payload;
      this._configureInstance(identifier, config);
    } else if ((notification === "PAUSE" || notification === "RESUME") && payload && payload.identifier) {
      const state = this.instances.get(payload.identifier);
      if (!state) return;
      state.paused = notification === "PAUSE";
      if (state.paused && state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      } else if (!state.paused && !state.timer && state.config) {
        this._scheduleNext(payload.identifier);
      }
    }
  },

  // Self-scheduling capture loop to prevent overlaps
  _scheduleNext (identifier) {
    const inst = this.instances.get(identifier);
    if (!inst || inst.paused) return;

    const config = inst.config || {};
    const mode = config.mode || "local";

    // Only schedule polling for modes that actually capture frames
    if (mode !== "local" && mode !== "snapshot") return;

    const interval = Math.max(500, Number(config.refreshSnapshotInterval) || 1000);

    inst.timer = setTimeout(async () => {
      inst.timer = null;
      await this._pollOnce(identifier, config);
      this._scheduleNext(identifier);
    }, interval);
  },

  _configureInstance (identifier, config) {
    // Clear existing timer if any
    const prev = this.instances.get(identifier);
    if (prev && prev.timer) clearTimeout(prev.timer);

    const data = { config, timer: null, paused: false, lastErrorAt: 0, inProgress: false };
    this.instances.set(identifier, data);

    const mode = (config && config.mode) || "local";
    if (mode === "local" || (mode === "snapshot" && config.refreshSnapshotInterval > 0)) {
      // Kick off immediately, then schedule the loop
      this._pollOnce(identifier, config).finally(() => {
        this._scheduleNext(identifier);
      });
    } else if (mode === "stream") {
      // Stream mode: no polling; optionally notify status connecting
      this.sendSocketNotification("STATUS", { identifier, status: "connecting" });
    }
  },

  async _pollOnce (identifier, config) {
    const rec = this.instances.get(identifier);
    if (!rec) return;

    // Prevent overlapping captures
    if (rec.inProgress) return;
    rec.inProgress = true;

    try {
      const mode = (config && config.mode) || "local";

      let timeoutMs;
      if (mode === "local") {
        // Strict, shorter timeout for local captures
        timeoutMs = 2000;
      } else {
        timeoutMs = Math.max(DEFAULT_TIMEOUT_MS, Number(config.offlineTimeout) || 0);
      }

      let result;
      if (mode === "local") {
        result = await captureLocalSnapshot(config, timeoutMs);
      } else {
        if (!config.url) {
          throw new Error("No URL configured for snapshot mode");
        }
        result = await fetchBuffer(config.url, timeoutMs);
      }

      const { buffer, contentType } = result;
      const base64 = buffer.toString("base64");
      const type = typeof contentType === "string" ? contentType.split(";")[0] : "image/jpeg";
      const dataUrl = `data:${type};base64,${base64}`;
      this.sendSocketNotification("SNAPSHOT", {
        identifier,
        image: dataUrl,
        timestamp: Date.now(),
        status: "online"
      });
    } catch (err) {
      const rec2 = this.instances.get(identifier);
      const now = Date.now();
      if (!rec2 || now - (rec2.lastErrorAt || 0) > 5000) {
        Log.error(
          `[MMM-PiCameraStream] snapshot capture error (${config && config.mode ? config.mode : "unknown mode"}): ${err && err.message ? err.message : err}`
        );
        if (rec2) rec2.lastErrorAt = now;
      }
      this.sendSocketNotification("STATUS", { identifier, status: "offline" });
    } finally {
      const rec3 = this.instances.get(identifier);
      if (rec3) rec3.inProgress = false;
    }
  }
});
