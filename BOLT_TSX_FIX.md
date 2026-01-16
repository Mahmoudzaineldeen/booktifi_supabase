# Fix: tsx command not found in Bolt/WebContainer

## Problem
Error: `jsh: command not found: tsx`

This happens in Bolt/WebContainer because `tsx` is not in the PATH even though it's installed in `node_modules`.

## Solution Applied

Updated `server/package.json` to use `npx tsx` instead of just `tsx`:

```json
"scripts": {
  "dev": "npx tsx watch src/index.ts",
  ...
}
```

## If Still Not Working

1. **Install dependencies in server directory**:
   ```bash
   cd server
   npm install
   ```

2. **Verify tsx is installed**:
   ```bash
   npx tsx --version
   ```

3. **Alternative: Use node with ts-node** (if tsx still doesn't work):
   ```json
   "dev": "node --loader tsx/esm src/index.ts"
   ```

## Files Changed
- `server/package.json` - Changed `tsx` to `npx tsx` in dev script
