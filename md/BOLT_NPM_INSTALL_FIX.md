# Fix: Cannot find package 'express' in Bolt/WebContainer

## Problem
Error: `Cannot find package 'express' imported from /home/project/server/src/index.ts`

This happens in Bolt/WebContainer when:
1. `node_modules` are not installed in the `server` directory
2. Module resolution doesn't work correctly with `npx tsx`

## Solution

### Step 1: Install Dependencies in Bolt

In your Bolt terminal, run:
```bash
cd server
npm install
cd ..
```

### Step 2: Verify Installation

Check that `express` is installed:
```bash
cd server
ls node_modules/express
```

### Step 3: Restart Dev Server

```bash
npm run dev
```

## Alternative: Auto-Install Script

The root `package.json` has been updated to check and install dependencies automatically:
```json
"dev:backend": "npm run setup:server-env && cd server && (test -d node_modules || npm install) && npm run dev"
```

However, in Bolt, you may need to run `npm install` manually in the `server` directory first.

## Why This Happens

In Bolt/WebContainer:
- Each directory needs its own `node_modules`
- `npx` might not resolve local packages correctly
- Dependencies must be installed in the `server` directory specifically

## Files Changed
- `package.json` - Added auto-install check for server dependencies
- `server/package.json` - Reverted to simple `tsx` command (works when node_modules exist)
