# Development Environment Setup

## Quick Start

Run both frontend and backend servers concurrently:

```bash
npm run dev
```

This single command starts:
- **Frontend** (Vite) on `http://localhost:5173`
- **Backend** (Express) on `http://localhost:3001`

## Individual Server Commands

### Frontend Only
```bash
npm run dev:frontend
```

### Backend Only
```bash
cd server
npm run dev
```

## How It Works

### Architecture
```
Browser → http://localhost:5173 (Vite Dev Server)
  ↓
  /api/* requests → Proxied to http://localhost:3001 (Express Server)
  ↓
  Response back to browser
```

### Vite Proxy Configuration
All frontend requests to `/api/*` are automatically proxied to the backend server at `http://localhost:3001`, eliminating CORS issues during development.

### Terminal Output
- `[dev:frontend]` - Vite dev server logs
- `[dev:backend]` - Express server logs

### Environment Variables
- `.env` in root directory contains Supabase configuration
- `server/.env` is automatically synced from root `.env` on startup

## Ports
- **Frontend**: `5173`
- **Backend**: `3001`

## Features
- Hot Module Replacement (HMR) for frontend
- Auto-reload on file changes for backend
- Unified terminal with prefixed logs
- No CORS configuration needed
- Single command startup
