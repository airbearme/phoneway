# Phoneway Deployment Guide

## Quick Start - One-Click Install

The app is already deployed and live at:
**https://phoneway.vercel.app**

### Install on Your Device (Any Platform)

1. **Open the URL** on your device: https://phoneway.vercel.app
2. **Wait for the install prompt** to appear (may take a few seconds)
3. **Click "Install"** or "Add to Home Screen"
4. **Done!** The app works offline and launches like a native app

### Platform-Specific Instructions

#### iPhone/iPad (iOS 13+)
1. Open Safari and go to https://phoneway.vercel.app
2. Tap the **Share** button (square with arrow)
3. Scroll down and tap **"Add to Home Screen"**
4. Tap **"Add"** in the top right
5. The app icon appears on your home screen

#### Android (Chrome)
1. Open Chrome and go to https://phoneway.vercel.app
2. Wait for the **"Install Phoneway"** banner at the bottom
3. Tap **"Install"**
4. The app appears in your app drawer

#### Desktop (Chrome/Edge)
1. Open https://phoneway.vercel.app
2. Click the **⊕ icon** in the address bar (or the install prompt)
3. Click **"Install"**
4. Find Phoneway in your Start Menu / Applications

---

## For Developers: Deploying Updates

### Option 1: Manual Deploy (Quick)

```bash
# Install Vercel CLI if you haven't
npm i -g vercel

# Login (one-time)
vercel login

# Deploy
vercel --prod
```

### Option 2: Auto-Deploy via GitHub (Recommended)

The project is configured with GitHub Actions for automatic deployment.

#### Setup Steps:

1. **Get Vercel credentials:**
   ```bash
   npx vercel login
   npx vercel teams list  # Get your org ID
   ```

2. **Add GitHub Secrets:**
   Go to your GitHub repo → Settings → Secrets and variables → Actions
   
   Add these 3 secrets:
   - `VERCEL_TOKEN` - Your Vercel personal access token
   - `VERCEL_ORG_ID` - From `vercel teams list` or `.vercel/project.json`
   - `VERCEL_PROJECT_ID` - From `.vercel/project.json`

3. **Push to main branch:**
   ```bash
   git add .
   git commit -m "v4.1.1 - cross-device compatibility"
   git push origin main
   ```

4. **Watch it deploy:**
   Go to GitHub → Actions tab to see the deployment progress

---

## Version Management

When releasing a new version:

1. **Update version numbers in:**
   - `index.html` - `APP_VERSION` constant and footer text
   - `manifest.json` - `version` field and all `start_url` entries
   - `sw.js` - `CACHE` constant
   - `AGENTS.md` - version references

2. **Test locally:**
   ```bash
   npx serve .
   # Test on http://localhost:3000
   ```

3. **Deploy:**
   ```bash
   vercel --prod
   ```

---

## Troubleshooting

### "Add to Home Screen" Not Appearing
- **iOS**: Must use Safari (not Chrome or other browsers)
- **Android**: Clear browser cache and reload
- **Desktop**: Check Chrome flags: `chrome://flags/#enable-desktop-pwas`

### App Not Working Offline
- Check that Service Worker registered: DevTools → Application → Service Workers
- Look for errors in console
- Try hard refresh: Ctrl+Shift+R (or Cmd+Shift+R on Mac)

### Motion Sensors Not Working
- **iOS 13+**: Must tap to grant permission (built into app)
- **Android**: Check Settings → Privacy → Motion sensors
- **Desktop**: Motion sensors not available (use manual entry)

### Calibration Not Saving
- Check that localStorage is enabled in browser
- Private/Incognito mode may block storage
- Try regular browsing mode

---

## Project Structure

```
phoneway/
├── index.html          # Main HTML entry point
├── manifest.json       # PWA manifest
├── sw.js              # Service Worker (caching)
├── vercel.json        # Vercel configuration
├── css/
│   └── style.css      # Main stylesheet
├── js/
│   ├── app.js         # Main application logic
│   ├── deviceCompat.js # Cross-device compatibility
│   ├── simpleScale.js # Core scale functionality
│   ├── sensors.js     # Sensor management
│   ├── kalman.js      # Filter algorithms
│   ├── display.js     # UI components
│   ├── precisionEngine.js # Precision measurements
│   └── ...            # Other modules
├── api/
│   ├── telemetry.js   # Usage analytics API
│   ├── stats.js       # Global stats API
│   └── errors.js      # Error dashboard API
└── icons/             # App icons
```

---

## Environment Variables

For Vercel deployment, set these in Vercel Dashboard → Project Settings → Environment Variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `BLOB_READ_WRITE_TOKEN` | Optional | For telemetry storage |
| `ERROR_VIEWER_KEY` | Optional | For accessing error dashboard |

---

## Support

For issues or questions:
1. Check browser console for errors
2. Visit `/api/errors?key=YOUR_KEY` (if you have the error viewer key)
3. Check Vercel deployment logs

---

**Current Version**: 4.1.1  
**Live URL**: https://phoneway.vercel.app  
**Status**: ✅ Production Ready
