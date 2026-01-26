# Fix: Database Not Configured

## Problem
You're seeing: `📊 Database: Not configured`

This means the server's `.env` file is missing the required Supabase configuration.

## Solution

### Step 1: Check if `server/.env` exists
The file should be at: `server/.env`

### Step 2: Add Supabase Configuration

Open `server/.env` and add these required variables:

```env
# Required: Supabase Configuration
SUPABASE_URL=https://zuauohhskeuzjglpkbsm.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# Server Configuration
PORT=3001
NODE_ENV=development
JWT_SECRET=your-secret-key-change-in-production
APP_URL=http://localhost:5173
```

### Step 3: Get Your Supabase Credentials

1. Go to your Supabase project: https://app.supabase.com
2. Select your project
3. Go to **Settings** → **API**
4. Copy:
   - **Project URL** → Use as `SUPABASE_URL`
   - **service_role key** (secret) → Use as `SUPABASE_SERVICE_ROLE_KEY`

⚠️ **Important**: Use the `service_role` key, NOT the `anon` key. The service role key has full database access.

### Step 4: Alternative - Use Root .env Variables

If you have Supabase credentials in the root `.env` file, the server will automatically use them:

```env
# In root .env
VITE_SUPABASE_URL=https://zuauohhskeuzjglpkbsm.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

However, for the backend, it's better to use `SUPABASE_SERVICE_ROLE_KEY` in `server/.env` for security.

### Step 5: Restart the Server

After updating `server/.env`, restart the server:

```bash
# Stop the current server (Ctrl+C)
# Then restart:
npm run dev
```

You should now see:
```
✅ Supabase client initialized: https://zuauohhskeuzjglpkbsm.supabase.co
✅ Database connection successful
📊 Database: db.zuauohhskeuzjglpkbsm.supabase.co:5432/postgres
```

## Quick Check

Run this to verify your configuration:

```bash
cd server
node -e "require('dotenv').config(); console.log('SUPABASE_URL:', process.env.SUPABASE_URL ? 'Set ✅' : 'Missing ❌'); console.log('SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'Set ✅' : 'Missing ❌');"
```

## Common Issues

### Issue: "Missing Supabase configuration"
**Solution**: Make sure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are in `server/.env`

### Issue: "Database connection test failed"
**Solution**: 
- Verify your Supabase project is active
- Check that the service role key is correct
- Ensure your IP is not blocked (check Supabase dashboard → Settings → Database)

### Issue: Still shows "Not configured"
**Solution**: 
- Make sure you're editing `server/.env` (not root `.env`)
- Restart the server after making changes
- Check for typos in variable names

## Note About DATABASE_URL

The message "Database: Not configured" checks for `DATABASE_URL`, but the actual database connection uses Supabase credentials (`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`). 

`DATABASE_URL` is optional and only used by some scripts. The main connection uses Supabase.
