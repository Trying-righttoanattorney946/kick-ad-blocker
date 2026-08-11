importScripts("/src/shared/constants.js");

const { STORAGE_KEY, MESSAGE_TYPE } = KickAdBlocker;

let counterWriteQueue = Promise.resolve();

function recordSkippedAd() {
  counterWriteQueue = counterWriteQueue
    .catch(() => {})
    .then(async () => {
      const stored = await chrome.storage.local.get({
        [STORAGE_KEY.ADS_SKIPPED]: 0,
      });
      await chrome.storage.local.set({
        [STORAGE_KEY.ADS_SKIPPED]: (stored[STORAGE_KEY.ADS_SKIPPED] || 0) + 1,
      });
    });
  return counterWriteQueue;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== MESSAGE_TYPE.AD_SKIPPED) return false;

  recordSkippedAd()
    .catch(() => {})
    .then(() => sendResponse(true));

  return true;
});
