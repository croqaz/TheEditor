---
title: Network bait
purpose: must load nothing while offline
---

# Network bait

Every resource below points at the network. Offline, each must render as a
placeholder and the audit must record zero non-loopback connections. With
`--online`, images load.

## Remote images

![Remote PNG](https://picsum.photos/400/200)

![Remote via HTTP](http://example.com/image.png)

<img src="https://picsum.photos/300/100" alt="HTML image" loading="eager">

## Remote CSS and fonts

<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter&display=swap">

<style>
@import url("https://example.com/remote.css");
@font-face { font-family: "RemoteFont"; src: url("https://example.com/font.woff2"); }
.bait { background: url("https://example.com/bg.png"); font-family: "RemoteFont"; }
</style>

<div class="bait">Styled by remote CSS if the sandbox leaks.</div>

## Remote media and frames

<video src="https://example.com/video.mp4" controls></video>

<iframe src="https://example.com/"></iframe>

<object data="https://example.com/doc.pdf"></object>

## Links (allowed to exist, never fetched or prefetched)

[Example](https://example.com) · <https://example.org> · https://example.net

## Local image for contrast

![Local](img/sample.png)
