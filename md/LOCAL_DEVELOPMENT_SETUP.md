# Local Development Setup Guide

## Using Railway Backend (Recommended)

To run the frontend locally while using the Railway backend:

### Option 1: Use .env.local file (Recommended)

1. Create a `.env.local` file in the project root:
   ```env
   VITE_API_URL=https://booktifisupabase-production.up.railway.app/api
   ```

2. Run only the frontend:
   ```bash
   npm run dev:frontend-only
   ```

   Or if you want to run both (but backend will fail if port 3001 is in use):
   ```bash
   npm run dev
   ```

### Option 2: Set Environment Variable

**Windows (PowerShell):**
```powershell
$env:VITE_API_URL="https://booktifisupabase-production.up.railway.app/api"
npm run dev:frontend-only
```

**Windows (CMD):**
```cmd
set VITE_API_URL=https://booktifisupabase-production.up.railway.app/api
npm run dev:frontend-only
```

**Linux/Mac:**
```bash
export VITE_API_URL=https://booktifisupabase-production.up.railway.app/api
npm run dev:frontend-only
```

## Fixing Port 3001 Conflict

If you see `Error: listen EADDRINUSE: address already in use :::3001`:

### Windows (PowerShell):
```powershell
# Find process using port 3001
netstat -ano | findstr :3001

# Kill the process (replace PID with the actual process ID)
taskkill /PID <PID> /F
```

### Windows (CMD):
```cmd
# Find process using port 3001
netstat -ano | findstr :3001

# Kill the process (replace PID with the actual process ID)
taskkill /PID <PID> /F
```

### Linux/Mac:
```bash
# Find process using port 3001
lsof -ti:3001

# Kill the process
kill -9 $(lsof -ti:3001)
```

## Using Local Backend

If you want to use a local backend instead:

1. **Remove or comment out** `VITE_API_URL` from `.env.local`:
   ```env
   # VITE_API_URL=https://booktifisupabase-production.up.railway.app/api
   ```

2. **Kill any process on port 3001** (see above)

3. **Run both frontend and backend**:
   ```bash
   npm run dev
   ```

## Verification

After starting the frontend, check the browser console. You should see:
```
[getApiUrl] Local development, using Railway backend: https://booktifisupabase-production.up.railway.app/api
```

Or if using local backend:
```
[getApiUrl] Using localhost: http://localhost:3001/api
```

## Troubleshooting

### Frontend still using localhost:3001

1. Check if `.env.local` exists and has `VITE_API_URL` set
2. Restart the Vite dev server (Vite reads env vars on startup)
3. Clear browser cache and hard refresh (Ctrl+Shift+R)

### CORS Errors

If you see CORS errors when using Railway backend:
- Railway backend should already have CORS configured
- Check Railway logs to see if requests are reaching the backend
- Verify the Railway backend is running and accessible

### Backend Connection Issues

1. Test Railway backend health:
   ```bash
   curl https://booktifisupabase-production.up.railway.app/health
   ```

2. Check Railway dashboard for deployment status

3. Verify environment variables in Railway are set correctly
