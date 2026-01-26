# Environment Setup Instructions

The Booktifi project has been successfully cloned and configured to work with your Supabase database. Below are the final configuration steps you need to complete.

## What Has Been Done

✅ Project files copied from GitHub repository
✅ Frontend dependencies installed
✅ Server dependencies installed
✅ Supabase URL and ANON_KEY configured in `.env`
✅ Basic environment variables set up

## Required Configuration

### 1. Supabase Database Password

You need to add your Supabase database password to the server configuration:

1. Go to your Supabase project dashboard: https://supabase.com/dashboard/project/zuauohhskeuzjglpkbsm
2. Navigate to **Settings** → **Database**
3. Find the **Connection string** section
4. Copy your database password
5. Edit `server/.env` and replace `[YOUR_DATABASE_PASSWORD]` with your actual password

The DATABASE_URL should look like:
```
DATABASE_URL=postgresql://postgres:YOUR_ACTUAL_PASSWORD@db.zuauohhskeuzjglpkbsm.supabase.co:5432/postgres
```

### 2. JWT Secret (Recommended)

For production use, you should change the JWT_SECRET in `server/.env` to a strong random string:
```bash
JWT_SECRET=your-secure-random-string-here
```

### 3. Optional Integrations

The following integrations are optional and can be configured later:

#### Zoho Books Integration
If you want to use Zoho Books for invoicing, configure these in `server/.env`:
- `ZOHO_CLIENT_ID`
- `ZOHO_CLIENT_SECRET`
- See `server/ZOHO_CREDENTIALS_SETUP.md` for detailed instructions

#### WhatsApp Integration
For WhatsApp notifications, configure:
- `WHATSAPP_PROVIDER`
- See `server/WHATSAPP_TOKEN_RENEWAL.md` for instructions

#### Email/SMTP
For email notifications, see `server/EMAIL_SETUP.md` for configuration instructions

## Running the Project

### Terminal 1: Start the Backend Server
```bash
cd server
npm run dev
```

The server will start on http://localhost:3001

### Terminal 2: Start the Frontend
```bash
npm run dev
```

The frontend will start on http://localhost:5173

## Verify Everything Works

1. **Check Server Health**: Visit http://localhost:3001/health
   - You should see: `{"status":"ok","database":"connected"}`

2. **Open the Application**: Visit http://localhost:5173
   - The application should load successfully

3. **Test Database Connection**: Try accessing any page that loads data from the database

## Current Environment Files

### Frontend: `.env`
```
VITE_SUPABASE_URL=https://zuauohhskeuzjglpkbsm.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ... (configured)
VITE_API_URL=http://localhost:3001/api
VITE_QR_SECRET=bookati-qr-secret-key-change-in-production
```

### Backend: `server/.env`
```
DATABASE_URL=postgresql://postgres:[YOUR_DATABASE_PASSWORD]@db.zuauohhskeuzjglpkbsm.supabase.co:5432/postgres
PORT=3001
NODE_ENV=development
JWT_SECRET=your-secret-key-change-in-production
APP_URL=http://localhost:5173
```

## Troubleshooting

### "Connection Refused" Error
- Make sure the backend server is running on port 3001
- Check that `VITE_API_URL` in `.env` matches the server port

### Database Connection Error
- Verify you've added the correct database password in `server/.env`
- Check that your Supabase project is active
- Ensure your IP is not blocked by Supabase (check Supabase dashboard → Settings → Database → Connection pooling)

### "Table doesn't exist" Error
- Make sure you've run all the database migrations from your previous setup
- Check that the database schema matches what the application expects

## Additional Documentation

The project includes extensive documentation:
- `server/README.md` - Server setup and troubleshooting
- `server/EMAIL_SETUP.md` - Email configuration
- `server/ZOHO_CREDENTIALS_SETUP.md` - Zoho Books integration
- `server/WHATSAPP_TOKEN_RENEWAL.md` - WhatsApp integration
- Various testing and setup guides in the root directory

## Next Steps

1. Add your database password to `server/.env`
2. Start both servers (backend and frontend)
3. Test the application
4. Configure optional integrations as needed
5. Change default secrets (JWT_SECRET, VITE_QR_SECRET) before deploying to production
