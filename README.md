# AntiGravity: Neon Pulse

[Play AntiGravity in a browser](https://shaunmcintyre813.github.io/mobile-arcade-game/)

## Install the full-screen Android app

[Download AntiGravity v1.1.0 for Android (Migration APK)](https://shaunmcintyre813.github.io/mobile-arcade-game/downloads/AntiGravity-Neon-Pulse-v1.1.0.apk)

Open the downloaded file on your phone and tap **Install** (or **Update** if updating over v1.0.0). Android may ask Chrome or Files for permission to install apps from that source. 

Once installed, launch the **AntiGravity** icon from your app drawer. 

### Key Capabilities of the v1.1.0 Android App:
- **Automatic Web Content Updates**: Future game-content updates published to [GitHub Pages](https://shaunmcintyre813.github.io/mobile-arcade-game/) are checked automatically on launch and downloaded securely in the background. Once verified against SHA-256 integrity hashes, new content takes effect seamlessly on the next launch—**no need to download or install another APK** for game content updates!
- **Round Protection**: Content updates are never applied mid-round while playing.
- **Offline Resilience & Fallback**: If the network is unavailable or an update download is interrupted, the app automatically runs the last known complete working release (falling back to the bundled APK assets if needed).
- **High Score Migration**: Your existing high score stored under `antigravity_high_score` is preserved and migrated into persistent native Android storage, ensuring web content updates do not reset your records.
- **Full-Screen Immersive Play**: True full-screen immersion without browser URL bars or navigation clutter.
- **Native Challenge Sharing**: Tap **Challenge / Text Friends** to launch Android's native sharing sheet and text challenge links to friends with your score encoded.

*Note: This v1.1.0 APK installation is a one-time upgrade. Future game content updates will flow automatically over the web. Only changes to native Android platform wrappers, permissions, or Java bridge code would require a new APK update in the future.*

## Signing & Security

This APK is signed with the repository's dedicated release key and preserves package ID `com.shaunmcintyre.antigravity.neonpulse`. Keep the local `release/` signing key and password file for any future native Android updates.

## Browser Edition

Open the browser link on any phone or desktop. A home-screen shortcut opens it in Chrome or Samsung Internet with offline service worker support.

To preview locally, run `npm run serve` and open `http://localhost:8080/`. Run `npm test` before publishing.
