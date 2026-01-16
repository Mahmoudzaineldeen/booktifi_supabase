# Fix: ERR_CONNECTION_REFUSED Error

## Understanding the Error

**Error Message**: `Failed to load resource: net::ERR_CONNECTION_REFUSED`  
**Location**: `db.ts:98`  
**Meaning**: The frontend cannot connect to the backend API server.

## Root Cause

The frontend application is trying to connect to `http://localhost:3001/api`, but the backend server is not running. This happens when:

1. The backend server hasn't been started
2. The server crashed or was stopped
3. The server is running on a different port
4. A firewall is blocking the connection

## Quick Fix

### Option 1: Use the Batch File (Easiest - Windows)

1. Navigate to the `server` folder
2. Double-click `start-server.bat`
3. Wait until you see: `🚀 API Server running on http://localhost:3001`

### Option 2: Use Terminal/Command Line

1. Open PowerShell or Command Prompt
2. Navigate to the server directory:
   ```powershell
   cd "C:\Users\MS\Downloads\project\server"
   ```
3. Start the server:
   ```powershell
   npm run dev
   ```
4. Wait until you see: `🚀 API Server running on http://localhost:3001`

### Option 3: Start Both Frontend and Backend Together

From the project root directory:
```powershell
npm run dev
```

This will start both the frontend (port 5173) and backend (port 3001) simultaneously.

## Verify the Server is Running

1. Open your browser
2. Navigate to: `http://localhost:3001/health`
3. You should see:
   ```json
   {
     "status": "ok",
     "database": "connected"
   }
   ```

## Configuration Check

Make sure your `.env` file (in the root directory) contains:
```env
VITE_API_URL=http://localhost:3001/api
```

And your `server/.env` file contains:
```env
PORT=3001
DATABASE_URL=your_database_connection_string
```

## Common Issues

### Port 3001 Already in Use
**Error**: `Port 3001 is already in use`

**Solution**:
1. Find and stop the process using port 3001:
   ```powershell
   netstat -ano | findstr :3001
   taskkill /PID <PID_NUMBER> /F
   ```
2. Or change the port in `server/.env` and update `VITE_API_URL` accordingly

### Database Connection Failed
**Error**: `Database connection failed`

**Solution**:
1. Ensure PostgreSQL/Supabase is running
2. Verify `DATABASE_URL` in `server/.env` is correct
3. Check database credentials

### Server Starts But Frontend Still Can't Connect
**Solution**:
1. Check if `VITE_API_URL` in `.env` matches the server port
2. Clear browser cache and reload
3. Check browser console for CORS errors
4. Verify firewall isn't blocking localhost connections

## Enhanced Error Messages

The error handling has been improved to show:
- Clear visual error messages in the console
- Step-by-step solution instructions
- The exact URL that failed to connect

## Prevention

To avoid this error in the future:
1. Always start the backend server before using the frontend
2. Use `npm run dev` from the root to start both servers together
3. Keep the server terminal window open while developing
4. Set up a process manager (like PM2) for production

## Need More Help?

- Check `server/README.md` for detailed server setup
- Check `START_SERVER.md` for server startup instructions
- Review `ENV_SETUP_INSTRUCTIONS.md` for environment configuration
