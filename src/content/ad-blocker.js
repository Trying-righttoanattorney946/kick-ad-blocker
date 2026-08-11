(() => {
  "use strict";

  const AD_MARKERS = [
    '[data-testid="ad-click-overlay"]',
    '[data-testid="ad-learn-more"]',
    '[data-testid="ad-fullscreen"]',
    '[aria-label="Ad progress"]',
    '[data-testid="ad-countdown"]',
  ];

  const AD_CHROME_SELECTORS = [
    '[data-testid="ad-click-overlay"]',
    '[data-testid="ad-learn-more"]',
    '[data-testid="ad-fullscreen"]',
    '[aria-label="Ad progress"]',
    '[aria-label^="Why this ad"]',
    ".z-player:has(> .animate-spin)",
  ];

  const AD_BADGE_SELECTOR = "span.tabular-nums";
  const AD_BADGE_PATTERN = /\bad\b/i;
  const BADGE_CONTAINER_SELECTOR = "div.z-controls";

  const STYLE_ID = "kab-mask";
  const HIDDEN_CLASS = "kab-hidden";

  const MAX_PLAYBACK_RATE = 16;
  const VIDEO_POKE_INTERVAL_MS = 400;
  const SEEK_SAFETY_MARGIN_S = 0.5;
  const MIN_SEEK_GAIN_S = 1;
  const AD_FAILSAFE_MS = 180_000;
  const POLL_INTERVAL_MS = 500;

  const state = {
    enabled: true,
    adActive: false,
    adStartedAt: 0,
    failsafeTripped: false,
    lastPokeAt: 0,
    adsHandled: 0,
  };

  const detector = {
    findBadges() {
      return Array.from(document.querySelectorAll(AD_BADGE_SELECTOR)).filter(
        (el) => AD_BADGE_PATTERN.test(el.textContent || "")
      );
    },

    isAdOnScreen() {
      if (AD_MARKERS.some((selector) => document.querySelector(selector))) {
        return true;
      }
      return detector.findBadges().length > 0;
    },
  };

  const mask = {
    apply() {
      if (document.getElementById(STYLE_ID)) return;
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = `
        ${AD_CHROME_SELECTORS.join(",\n        ")},
        .${HIDDEN_CLASS} {
          display: none !important;
          pointer-events: none !important;
        }
        video {
          visibility: hidden !important;
        }
      `;
      (document.head || document.documentElement).appendChild(style);
    },

    hideBadges() {
      for (const badge of detector.findBadges()) {
        const container = badge.closest(BADGE_CONTAINER_SELECTOR) || badge;
        container.classList.add(HIDDEN_CLASS);
      }
    },

    clear() {
      document.getElementById(STYLE_ID)?.remove();
      for (const el of document.querySelectorAll(`.${HIDDEN_CLASS}`)) {
        el.classList.remove(HIDDEN_CLASS);
      }
    },
  };

  const player = {
    videos() {
      return document.querySelectorAll("video");
    },

    bufferedTarget(video) {
      const ranges = video.buffered;
      if (!ranges.length) return null;
      return ranges.end(ranges.length - 1) - SEEK_SAFETY_MARGIN_S;
    },

    suppress() {
      for (const video of player.videos()) {
        try {
          video.muted = true;

          if (Number.isFinite(video.duration) && video.duration > 0) {
            video.playbackRate = MAX_PLAYBACK_RATE;
          }

          const target = player.bufferedTarget(video);
          if (target !== null && target - video.currentTime > MIN_SEEK_GAIN_S) {
            video.currentTime = target;
          }

          if (video.paused) video.play().catch(() => {});
        } catch (_) {}
      }
    },

    restore() {
      for (const video of player.videos()) {
        try {
          if (video.playbackRate > 1) video.playbackRate = 1;
          if (video.paused) video.play().catch(() => {});
        } catch (_) {}
      }
    },
  };

  const counter = {
    increment() {
      state.adsHandled += 1;
      try {
        chrome.storage.local.set({
          [KAB.STORAGE.ADS_HANDLED]: state.adsHandled,
        });
      } catch (_) {}
    },
  };

  const controller = {
    beginAd(now) {
      state.adActive = true;
      state.adStartedAt = now;
      state.failsafeTripped = false;
      counter.increment();
      mask.apply();
    },

    endAd() {
      state.adActive = false;
      state.failsafeTripped = false;
      state.lastPokeAt = 0;
      mask.clear();
      player.restore();
    },

    tripFailsafe() {
      state.failsafeTripped = true;
      mask.clear();
      player.restore();
    },

    handleAdFrame() {
      const now = performance.now();

      if (!state.adActive) controller.beginAd(now);

      if (!state.failsafeTripped && now - state.adStartedAt > AD_FAILSAFE_MS) {
        controller.tripFailsafe();
      }
      if (state.failsafeTripped) return;

      if (now - state.lastPokeAt < VIDEO_POKE_INTERVAL_MS) return;
      state.lastPokeAt = now;

      mask.hideBadges();
      player.suppress();
    },

    sync() {
      if (!state.enabled) {
        if (state.adActive) controller.endAd();
        return;
      }

      if (detector.isAdOnScreen()) controller.handleAdFrame();
      else if (state.adActive) controller.endAd();
    },

    start() {
      new MutationObserver(controller.sync).observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["data-testid", "aria-label"],
      });
      setInterval(controller.sync, POLL_INTERVAL_MS);
      controller.sync();
    },
  };

  const settings = {
    load() {
      chrome.storage.local.get(
        { [KAB.STORAGE.ENABLED]: true, [KAB.STORAGE.ADS_HANDLED]: 0 },
        (stored) => {
          state.enabled = stored[KAB.STORAGE.ENABLED] !== false;
          state.adsHandled = stored[KAB.STORAGE.ADS_HANDLED] || 0;
          controller.start();
        }
      );
    },

    watch() {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local" || !changes[KAB.STORAGE.ENABLED]) return;
        state.enabled = changes[KAB.STORAGE.ENABLED].newValue !== false;
        controller.sync();
      });
    },
  };

  settings.load();
  settings.watch();
})();
