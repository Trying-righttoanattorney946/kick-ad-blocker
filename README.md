# Kick Ad Blocker — Skip Stream Ads on Kick.com (Chrome MV3)

**Kick Ad Blocker is a Manifest V3 Chrome extension that skips and hides video
ads on Kick.com livestreams.** It works on two layers: it blocks common
ad-network requests before they load, and it detects the player's own "an ad is
running" markers to mute, blank and fast-forward the ad clip in place.

**How do you block ads on Kick?** Install the extension, open a channel, and it
handles the pre-roll and mid-roll ads by itself — no per-stream setup, no
settings to tune. The toolbar popup has a single on/off toggle plus counters
for ads handled and requests blocked.

Built and tested against Kick.com with the site's permission, as an interview
case study. The player-side selectors are Kick-specific; the network block list
is generic and works anywhere.

## Install (unpacked, for review)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this folder.
4. Pin the extension and click it to see the toggle and counters.

## Project structure

```
manifest.json
icons/                      16 / 48 / 128 px action + store icons
rules/ad-networks.json      declarativeNetRequest block list
src/
  shared/constants.js       storage keys, message names, repo URL
  content/ad-blocker.js     detector / mask / player / controller
  background/service-worker.js
  popup/index.html + popup.css + popup.js
```

The source files carry no comments by design: the reasoning lives in this
README, and the code is expected to read on its own. Named constants
(`SEEK_SAFETY_MARGIN_S`, `VIDEO_POKE_INTERVAL_MS`, `AD_FAILSAFE_MS`) stand in
for the explanations that would otherwise sit inline.

`content/ad-blocker.js` splits into four units with one job each:

| Unit         | Responsibility                                          |
| ------------ | ------------------------------------------------------- |
| `detector`   | is an ad on screen right now                             |
| `mask`       | inject/remove the CSS that blanks the frame and ad chrome|
| `player`     | mute, seek and rate-control every `<video>`              |
| `controller` | state machine + timing; the only unit that owns "when"   |

There is no build step and no bundler. `shared/constants.js` is a plain script
loaded three ways — listed in `content_scripts.js`, `importScripts()`d by the
service worker, and a `<script>` tag in the popup — so all three contexts agree
on the storage keys without a module graph.

## How it works

**Network layer — `rules/ad-networks.json` + declarativeNetRequest.**
Static block rules for common ad/tracking hosts (DoubleClick, googlesyndication,
adnxs, amazon-adsystem, IMA SDK, etc.). This runs without a background loop and
is the cheapest, most reliable win. Add or remove hosts by editing that file.

**Player layer — `src/content/ad-blocker.js`.**
The pasted markup exposes clear "ad is playing" signals, so detection keys off
those rather than guessing:

- `[data-testid="ad-click-overlay"]` — the transparent click-catcher
- `[data-testid="ad-learn-more"]`, `[data-testid="ad-fullscreen"]`
- `[aria-label="Ad progress"]` — the ad progress bar
- an `Ad 1 of N` badge as a text fallback

When any of those appear, the script:

1. blanks the frame (`video { visibility: hidden }`) so the ad is never seen
   even when it cannot be skipped — the player wrapper is already black,
2. mutes every `<video>`,
3. seeks to the end of the **buffered** range (not `duration`) and, for a
   discrete clip with a finite `duration`, runs it at 16x,
4. hides the overlay, click-catcher, "Learn More", "Why this ad?", the ad
   progress bar, the `Ad 1 of N` badge and the buffering spinner,
5. bumps the "ads handled" counter in `chrome.storage`.

Two things keep this from stalling the player, which is the failure mode that
freezes an ad on screen instead of skipping it:

- **Never seek to `duration`.** With an MSE/HLS player that point is not
  buffered, so playback hangs there and `ended` never fires — the ad sits
  frozen and its overlay never tears down. `SEEK_SAFETY_MARGIN_S` keeps the
  target half a second inside loaded media, and `MIN_SEEK_GAIN_S` skips the
  seek entirely when there is less than a second to gain, because landing on
  the buffer edge re-stalls the player for no benefit.
- **Throttle the video pokes** (`VIDEO_POKE_INTERVAL_MS`). The
  `MutationObserver` fires many times per second while the controls animate;
  seeking on every one of those pins playback in place. The observer watches
  `data-testid` / `aria-label` only — not `class`, which the player rewrites
  constantly — with a 500 ms interval as a safety net because players recreate
  the `<video>` node mid-ad.

When the ad markers disappear, the controller restores `playbackRate`, removes
the mask, and nudges a stalled stream back into play.

The popup toggle writes the enabled flag to `chrome.storage.local`; the content
script reads it and listens for changes, so pausing takes effect without a
reload.

## Permissions, and why each one is there

| Permission                     | Why                                                |
| ------------------------------ | -------------------------------------------------- |
| `declarativeNetRequest`        | the static block list in `rules/ad-networks.json`   |
| `declarativeNetRequestFeedback`| `getMatchedRules()` for the popup's blocked count   |
| `storage`                      | the on/off toggle and the counters                  |

There is **no `host_permissions` entry**, so Chrome does not ask for "read your
data on all websites". A declared content script is granted by its `matches`
alone, and a declarativeNetRequest `block` rule needs no host permission — only
`redirect` and `modifyHeaders` do. So the player script runs on `kick.com` and
nowhere else, while the network block list still applies everywhere.

If an ad marker ever fails to clear, the controller trips a failsafe after
`AD_FAILSAFE_MS` (three minutes) and gives the player back rather than leaving
it blacked out for good.

## Honest limitations (worth stating in the interview)

- **Client-side hiding + mute always works.** It removes the overlay and kills
  the audio regardless of how the ad is delivered.
- **The skip is bounded by download speed, not by playback speed.** At 16x
  with the seek pinned to the buffer edge, the ad is consumed as fast as its
  segments arrive — so the buffer stays empty and the player's spinner runs for
  the whole ad. That spinner is hidden rather than avoided: keeping it quiet
  would mean playing the ad closer to real time, which is the opposite of the
  goal.
- **Fast-forward/seek only works for *discrete* ad clips** — a separate,
  seekable `<video>` with a finite `duration`. If the platform uses
  **server-side ad insertion (SSAI)**, the ad is stitched into the same HLS
  manifest as the stream, so there is no separate clip to seek and no ad
  request to block. Defeating that properly means manifest/segment
  manipulation (e.g. a filtering proxy or a custom MSE loader that drops ad
  segments), which is a much larger piece of work than a content script.
- Selectors are tuned to the markup sample provided. If the site ships an
  update, `AD_MARKERS` and `AD_CHROME_SELECTORS` are the one place to adjust.
- The blocked-request counter comes from `getMatchedRules()`, which only
  reports rules matched in the last five minutes, so it is a live indicator
  rather than a lifetime total.

## Branding note

The icon is an original shield-and-play mark. It borrows Kick's bright green
(`#53FC18`) on dark so it sits naturally next to the site, but it is **not**
Kick's logo — permission to test on the site is not a trademark licence, and
the Chrome Web Store rejects icons that imitate another company's branding.
