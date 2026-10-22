# AntiGravity: Neon Pulse

[Play AntiGravity in a browser](https://shaunmcintyre813.github.io/mobile-arcade-game/)

## Install the full-screen Android app

[Download AntiGravity for Android (APK)](https://shaunmcintyre813.github.io/mobile-arcade-game/downloads/AntiGravity-Neon-Pulse-v1.0.0.apk). Open the downloaded file on your phone and tap **Install**. Android may ask Chrome or Files for permission to install apps from that source. Once installed, launch the **AntiGravity** icon from your app drawer. The Android edition opens full screen and contains the game files for offline play. It has its own high score storage, separate from Chrome's web copy.

This APK is signed for direct installation and is not distributed through Google Play. If Play Protect warns about a newly signed sideloaded app, review that the download came from this repository before choosing whether to continue. Keep the local `release/` signing key and password file for future updates; they are intentionally excluded from Git.

## Browser edition

Open the browser link on a phone. A home-screen shortcut opens it in Chrome. After the first online visit, its service worker caches the game for offline play.

The source is available in this repository. To preview locally, run `npm run serve` and open `http://localhost:8080/`. Run `npm test` before publishing. On the configured Windows Android SDK, `./android/build-android.ps1` builds and signs a new APK from the current source. A push to `main` publishes through the [GitHub Pages workflow](.github/workflows/pages.yml) after the tests pass.
