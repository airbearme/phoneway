# GitHub Secrets Setup Guide

## Auto-Deployment Configuration

The GitHub Actions workflow is configured but needs secrets to enable auto-deployment on push to `main`.

## ✅ GitHub Repo Connected

Vercel CLI has connected your repo: `https://github.com/airbearme/phoneway`

## Updated Project IDs (from vercel link)

```json
{
  "orgId": "team_0EMygx8IhzPBfSPFoKlZv3kQ",
  "projectId": "prj_bVGgKc06GdzlHvIidYYq9umEuxt5"
}
```

## Required Secrets

Go to: **GitHub Repo → Settings → Secrets and variables → Actions → New repository secret**

Add these three secrets:

| Secret Name | Value |
|-------------|-------|
| `VERCEL_TOKEN` | Your Vercel personal access token |
| `VERCEL_ORG_ID` | `team_0EMygx8IhzPBfSPFoKlZv3kQ` |
| `VERCEL_PROJECT_ID` | `prj_bVGgKc06GdzlHvIidYYq9umEuxt5` |

## How to Get VERCEL_TOKEN

1. Go to https://vercel.com/dashboard/settings/tokens
2. Click "Create Token"
3. Name: `GitHub Actions Deploy`
4. Scope: Select your phoneway project
5. Copy the token and add as `VERCEL_TOKEN` secret

Or run this to set all secrets at once:

```bash
# After getting your token from https://vercel.com/dashboard/settings/tokens
TOKEN="your_vercel_token_here"
gh secret set VERCEL_TOKEN --body "$TOKEN"
gh secret set VERCEL_ORG_ID --body "team_0EMygx8IhzPBfSPFoKlZv3kQ"
gh secret set VERCEL_PROJECT_ID --body "prj_bVGgKc06GdzlHvIidYYq9umEuxt5"
```

## Verification

After adding secrets:
1. Push any commit to `main` branch
2. Go to GitHub → Actions tab
3. You should see "Deploy to Vercel" workflow running
4. On success, app deploys to https://phoneway.vercel.app

## Current Deployment Status

✅ **Manual deployment working** - App is live at https://phoneway.vercel.app  
✅ **GitHub repo connected** to Vercel project  
⏳ **Auto-deployment pending** - Waiting for GitHub secrets

---

*Updated: 2026-03-13*
