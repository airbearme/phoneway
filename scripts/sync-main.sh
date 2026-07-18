#!/usr/bin/env bash
set -euo pipefail

branch="$(git branch --show-current)"
if [[ "$branch" != "main" ]]; then
  echo "Run this from the main branch; current branch is $branch" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean. Commit or stash changes before syncing." >&2
  exit 1
fi

git fetch origin main
git pull --ff-only origin main
git push origin main

echo "Synced main. Vercel will deploy the pushed commit through the GitHub integration."
