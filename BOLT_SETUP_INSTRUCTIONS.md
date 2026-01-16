# Bolt/WebContainer Setup Instructions

## Issue: Cannot find package 'express'

This error occurs because `node_modules` are not installed in the `server` directory in Bolt.

## Quick Fix

Run this command in Bolt terminal:

```bash
cd server
npm install
cd ..
npm run dev
```

## Automatic Fix (After Pull)

The `package.json` has been updated to automatically install server dependencies. After pulling the latest changes:

```bash
git pull
npm run dev
```

The script will automatically check and install dependencies if needed.

## Manual Verification

To verify dependencies are installed:

```bash
cd server
ls node_modules/express
```

If you see the `express` directory, dependencies are installed correctly.

## Why This Happens

In Bolt/WebContainer:
- Each subdirectory needs its own `node_modules`
- Dependencies from root `package.json` don't automatically install in `server/`
- You need to run `npm install` in the `server` directory

## Files Changed

- `package.json` - Added `install:server-deps` script
- `server/package.json` - Uses simple `tsx` command (works when node_modules exist)
