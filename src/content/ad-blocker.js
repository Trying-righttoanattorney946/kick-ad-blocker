(() => {
  "use strict";

  const { STORAGE_KEY, MESSAGE_TYPE } = KickAdBlocker;

  const AD_SIGNAL_SELECTORS = [
    '[data-testid="ad-click-overlay"]',
    '[data-testid="ad-learn-more"]',
    '[data-testid="ad-fullscreen"]',
    '[data-testid="ad-countdown"]',
    '[aria-label="Ad progress"]',
  ];

  const AD_DECORATION_SELECTORS = [
    '[aria-label^="Why this ad"]',
    ".z-player:has(> .animate-spin)",
  ];

  const AD_COUNTER_BADGE_SELECTOR = "span.tabular-nums";
  const AD_COUNTER_BADGE_PATTERN = /\bad\b/i;
  const PLAYER_CONTROL_BAR_SELECTOR = "div.z-controls";

  const MASK_STYLE_ELEMENT_ID = "kick-ad-blocker-mask";
  const MASKED_ELEMENT_CLASS = "kick-ad-blocker-masked";

  const FAST_FORWARD_PLAYBACK_RATE = 16;
  const PLAYER_NUDGE_INTERVAL_MS = 400;
  const SEEK_SAFETY_MARGIN_S = 0.5;
  const MIN_SEEK_GAIN_S = 1;
  const STUCK_AD_TIMEOUT_MS = 180_000;
  const DETECTION_POLL_INTERVAL_MS = 500;

  const state = {
    protectionEnabled: true,
    adOnScreen: false,
    adDetectedAt: 0,
    stuckAdTimeoutTripped: false,
    lastNudgeAt: 0,
  };

  const preAdMediaState = new WeakMap();

  const detector = {
    adCounterBadges() {
      const candidates = document.querySelectorAll(AD_COUNTER_BADGE_SELECTOR);
      return Array.from(candidates).filter((element) =>
        AD_COUNTER_BADGE_PATTERN.test(element.textContent || "")
      );
    },

    isAdPlaying() {
      const hasSignalElement = AD_SIGNAL_SELECTORS.some((selector) =>
        document.querySelector(selector)
      );
      return hasSignalElement || detector.adCounterBadges().length > 0;
    },
  };

  const mask = {
    apply() {
      if (document.getElementById(MASK_STYLE_ELEMENT_ID)) return;

      const hiddenSelectors = [
        ...AD_SIGNAL_SELECTORS,
        ...AD_DECORATION_SELECTORS,
        `.${MASKED_ELEMENT_CLASS}`,
      ];

      const styleElement = document.createElement("style");
      styleElement.id = MASK_STYLE_ELEMENT_ID;
      styleElement.textContent = `
        ${hiddenSelectors.join(",\n        ")} {
          display: none !important;
          pointer-events: none !important;
        }
        video {
          visibility: hidden !important;
        }
      `;
      (document.head || document.documentElement).appendChild(styleElement);
    },

    hideAdCounterBadges() {
      for (const badge of detector.adCounterBadges()) {
        const controlBar = badge.closest(PLAYER_CONTROL_BAR_SELECTOR) || badge;
        controlBar.classList.add(MASKED_ELEMENT_CLASS);
      }
    },

    clear() {
      document.getElementById(MASK_STYLE_ELEMENT_ID)?.remove();
      const masked = document.querySelectorAll(`.${MASKED_ELEMENT_CLASS}`);
      for (const element of masked) {
        element.classList.remove(MASKED_ELEMENT_CLASS);
      }
    },
  };

  const player = {
    videoElements() {
      return document.querySelectorAll("video");
    },

    rememberPreAdState(video) {
      if (preAdMediaState.has(video)) return;
      preAdMediaState.set(video, {
        muted: video.muted,
        playbackRate: video.playbackRate,
      });
    },

    seekTargetWithinBuffer(video) {
      const buffered = video.buffered;
      if (!buffered.length) return null;
      return buffered.end(buffered.length - 1) - SEEK_SAFETY_MARGIN_S;
    },

    fastForwardThroughAd() {
      for (const video of player.videoElements()) {
        try {
          player.rememberPreAdState(video);
          video.muted = true;

          if (Number.isFinite(video.duration) && video.duration > 0) {
            video.playbackRate = FAST_FORWARD_PLAYBACK_RATE;
          }

          const seekTarget = player.seekTargetWithinBuffer(video);
          const seekGain = seekTarget === null ? 0 : seekTarget - video.currentTime;
          if (seekGain > MIN_SEEK_GAIN_S) {
            video.currentTime = seekTarget;
          }

          if (video.paused) video.play().catch(() => {});
        } catch {}
      }
    },

    restorePreAdState() {
      for (const video of player.videoElements()) {
        const preAdState = preAdMediaState.get(video);
        try {
          if (preAdState) {
            video.muted = preAdState.muted;
            video.playbackRate = preAdState.playbackRate;
          }
          if (video.paused) video.play().catch(() => {});
        } catch {}
        preAdMediaState.delete(video);
      }
    },
  };

  const reporter = {
    adSkipped() {
      try {
        chrome.runtime
          .sendMessage({ type: MESSAGE_TYPE.AD_SKIPPED })
          .catch(() => {});
      } catch {}
    },
  };

  const controller = {
    onAdDetected(timestamp) {
      state.adOnScreen = true;
      state.adDetectedAt = timestamp;
      state.stuckAdTimeoutTripped = false;
      mask.apply();
      reporter.adSkipped();
    },

    onAdFinished() {
      state.adOnScreen = false;
      state.stuckAdTimeoutTripped = false;
      state.lastNudgeAt = 0;
      mask.clear();
      player.restorePreAdState();
    },

    releaseStuckPlayer() {
      state.stuckAdTimeoutTripped = true;
      mask.clear();
      player.restorePreAdState();
    },

    suppressAd() {
      const now = performance.now();

      if (!state.adOnScreen) controller.onAdDetected(now);

      const adHasOutlivedTimeout =
        now - state.adDetectedAt > STUCK_AD_TIMEOUT_MS;
      if (!state.stuckAdTimeoutTripped && adHasOutlivedTimeout) {
        controller.releaseStuckPlayer();
      }
      if (state.stuckAdTimeoutTripped) return;

      if (now - state.lastNudgeAt < PLAYER_NUDGE_INTERVAL_MS) return;
      state.lastNudgeAt = now;

      mask.hideAdCounterBadges();
      player.fastForwardThroughAd();
    },

    sync() {
      if (!state.protectionEnabled) {
        if (state.adOnScreen) controller.onAdFinished();
        return;
      }

      if (detector.isAdPlaying()) controller.suppressAd();
      else if (state.adOnScreen) controller.onAdFinished();
    },

    start() {
      new MutationObserver(controller.sync).observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["data-testid", "aria-label"],
      });
      setInterval(controller.sync, DETECTION_POLL_INTERVAL_MS);
      controller.sync();
    },
  };

  const settings = {
    watchForChanges() {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        const change = changes[STORAGE_KEY.PROTECTION_ENABLED];
        if (areaName !== "local" || !change) return;
        state.protectionEnabled = change.newValue !== false;
        controller.sync();
      });
    },

    async loadThenStart() {
      try {
        const stored = await chrome.storage.local.get({
          [STORAGE_KEY.PROTECTION_ENABLED]: true,
        });
        state.protectionEnabled =
          stored[STORAGE_KEY.PROTECTION_ENABLED] !== false;
      } catch {}
      controller.start();
    },
  };

  settings.watchForChanges();
  settings.loadThenStart();
})();
