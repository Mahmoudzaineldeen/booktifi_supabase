# 🚀 How to Start the Backend Server

## Quick Start

### Option 1: Using PowerShell Script (Windows)
```powershell
cd project/server
.\start-server.ps1
```

### Option 2: Manual Start
```bash
cd project/server
npm install  # Only needed first time
npm run dev
```

### Option 3: Using Batch File (Windows)
```bash
cd project/server
start-server.bat
```

## Verify Server is Running

Once started, you should see:
```
Server running on port 3001
Database connected
```

## Test the Server

Open in browser: http://localhost:3001/api/health

You should see:
```json
{
  "status": "ok",
  "database": "connected"
}
```

## Troubleshooting

### Port Already in Use
If port 3001 is already in use:
1. Find and stop the process using port 3001
2. Or change PORT in `server/.env` file

### Database Connection Error
Check `server/.env` file has correct `DATABASE_URL`

### Missing Dependencies
Run: `cd project/server && npm install`

## Required Environment Variables

Make sure `project/server/.env` has:
```env
PORT=3001
DATABASE_URL=your-database-connection-string
JWT_SECRET=your-secret-key
```

## After Starting

Once the server is running, try creating a booking again in the reception page.


