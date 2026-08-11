importScripts("/src/shared/constants.js");

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get({
    [KAB.STORAGE.ENABLED]: true,
  });
  await chrome.storage.local.set({
    [KAB.STORAGE.ENABLED]: stored[KAB.STORAGE.ENABLED] !== false,
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== KAB.MESSAGE.GET_BLOCKED_COUNT) return false;

  chrome.declarativeNetRequest
    .getMatchedRules({})
    .then((result) => sendResponse({ count: result.rulesMatchedInfo.length }))
    .catch(() => sendResponse({ count: 0 }));

  return true;
});
