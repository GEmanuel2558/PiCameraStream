/*
 * MMM-PiCameraStream
 * A MagicMirror² module to display a Raspberry Pi camera MJPEG stream or periodic snapshots.
 */

/* MagicMirror Module: MMM-PiCameraStream */
Module.register("MMM-PiCameraStream", {
  requiresVersion: "2.22.0",
  // Default module config
  defaults: {
    // Operating mode: "local" | "snapshot" | "stream"
    mode: "local",
    // Only used for "snapshot" or "stream" modes
    url: "",
    width: 640,
    height: 480,

    // Used in "local" and "snapshot" modes; ignored for "stream"
    refreshSnapshotInterval: 1000, // 1 second snapshot interval

    showStatus: true,
    offlineTimeout: 8000 // ms (also used as a network timeout baseline in helper)
  },

  start () {
    if (typeof Log !== "undefined") Log.info("[MMM-PiCameraStream] starting...");
    // Normalize/validate mode
    this.config.mode = this.config.mode || "local";
    if (!["local", "snapshot", "stream"].includes(this.config.mode)) {
      this.config.mode = "local";
    }
    // Basic config validation/coercion
    this.config.width = Number(this.config.width) || 640;
    this.config.height = Number(this.config.height) || 480;
    this.config.refreshSnapshotInterval = Math.max(0, Number(this.config.refreshSnapshotInterval) || 0);
    this.config.offlineTimeout = Math.max(0, Number(this.config.offlineTimeout) || 0);
    this.imageSrc = null;
    this.status = "INIT";
    this.lastPing = 0;
    this.imgEl = null;
    this.statusEl = null;

    this.sendSocketNotification("CONFIG", {
      identifier: this.identifier,
      config: this.config
    });

    // Periodically check offline status
    const checkInterval = Math.max(1000, Math.min(this.config.offlineTimeout, 5000));
    this._statusTimer = setInterval(() => {
      if (!this.config.showStatus) return;
      if (this.config.offlineTimeout <= 0) return;
      const now = Date.now();
      const delta = now - this.lastPing;
      if (this.config.mode === "stream") {
        // Stream mode: heuristic based on load/error events; also use time since last load event
        if (this.lastPing === 0) {
          this._setStatus("Connecting...");
        } else if (delta > this.config.offlineTimeout) {
          this._setStatus("Offline");
        } else {
          this._setStatus("Online");
        }
      } else {
        // Local/Snapshot mode: rely on data pings from helper
        if (this.lastPing === 0) {
          this._setStatus("Connecting...");
        } else if (delta > this.config.offlineTimeout) {
          this._setStatus("Offline");
        } else {
          this._setStatus("Online");
        }
      }
    }, checkInterval);
  },

  getStyles () {
    return ["MMM-PiCameraStream.css"];
  },

  getDom () {
    const root = document.createElement("div");
    root.className = "mmm-picamerastream";

    const videoContainer = document.createElement("div");
    videoContainer.className = "mmm-picamerastream-video-container";

    const img = document.createElement("img");
    img.alt = "Pi Camera Stream";
    img.decoding = "async";
    img.width = this.config.width;
    img.height = this.config.height;

    if (this.config.mode === "stream") {
      // Stream mode: directly use the MJPEG stream URL
      img.src = this.config.url;
      // Attach simple online/offline detection based on image events
      img.addEventListener("load", () => {
        this.lastPing = Date.now();
        this._setStatus("Online");
      });
      img.addEventListener("error", () => {
        this._setStatus("Offline");
      });
    } else {
      // Local or Snapshot mode: will be updated via socket notifications
      if (this.imageSrc) {
        img.src = this.imageSrc;
      } else {
        // placeholder transparent pixel
        img.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
      }
    }

    videoContainer.appendChild(img);
    this.imgEl = img;
    root.appendChild(videoContainer);

    if (this.config.showStatus) {
      const status = document.createElement("div");
      status.className = "mmm-picamerastream-status";
      status.textContent = this.status || "";
      this.statusEl = status;
      root.appendChild(status);
    }

    return root;
  },

  socketNotificationReceived (notification, payload) {
    if (!payload || payload.identifier !== this.identifier) return;

    if (notification === "SNAPSHOT") {
      if (typeof Log !== "undefined") Log.info("[MMM-PiCameraStream] snapshot received");
      // payload: { identifier, image, timestamp, status? }
      this.imageSrc = payload.image;
      this.lastPing = Date.now();
      if (this.imgEl && this.config.mode !== "stream") {
        this.imgEl.src = this.imageSrc;
      }
      if (payload.status) this._setStatus(payload.status);
      this.updateDom();
    } else if (notification === "STATUS") {
      // payload: { identifier, status }
      if (typeof payload.status === "string") {
        if (payload.status.toLowerCase() === "online") {
          this.lastPing = Date.now();
        }
        if (typeof Log !== "undefined") Log.info(`[MMM-PiCameraStream] status ${payload.status}`);
        this._setStatus(payload.status);
        this.updateDom();
      }
    }
  },

  notificationReceived (notification) {
    if (notification === "ALL_MODULES_STARTED") {
      // Re-send config to be robust to startup ordering
      this.sendSocketNotification("CONFIG", { identifier: this.identifier, config: this.config });
    }
  },

  _setStatus (text) {
    this.status = text;
    if (this.statusEl) {
      this.statusEl.textContent = text;
      const cls = text && text.toLowerCase().includes("online") ? "online" : (text && text.toLowerCase().includes("connect") ? "connecting" : "offline");
      this.statusEl.classList.remove("online", "offline", "connecting");
      this.statusEl.classList.add(cls);
    }
  },

  // Pause polling when module is hidden
  suspend () {
    if (typeof Log !== "undefined") Log.info("[MMM-PiCameraStream] suspend");
    this.sendSocketNotification("PAUSE", { identifier: this.identifier });
  },

  // Resume polling when module is shown again
  resume () {
    if (typeof Log !== "undefined") Log.info("[MMM-PiCameraStream] resume");
    this.sendSocketNotification("RESUME", { identifier: this.identifier });
  },

  stop () {
    if (this._statusTimer) {
      clearInterval(this._statusTimer);
      this._statusTimer = null;
    }
  }
});
