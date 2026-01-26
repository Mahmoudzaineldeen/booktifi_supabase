# Where to Find Server Console Logs

## ⚠️ Important: Server Console ≠ Browser Console

**Server Console** = The terminal/command prompt where you started your Node.js server  
**Browser Console (F12)** = Developer tools in your web browser (NOT where server logs appear)

## How to Find Server Console Logs

### Step 1: Find Your Server Terminal

The server console is the **terminal/command prompt** where you ran:

```bash
cd server
npm run dev
```

This is usually:
- **Windows**: Command Prompt, PowerShell, or Terminal window
- **Mac/Linux**: Terminal window
- **VS Code**: Integrated Terminal panel

### Step 2: Look for Ticket Generation Logs

After creating a booking, you should see logs like this in your **SERVER TERMINAL**:

```
📧 ========================================
📧 Starting ticket generation for booking <ID>...
   Customer: <name>
   Email: <email>
   Phone: <phone>
📧 ========================================

📄 Step 1: Generating PDF for booking...
✅ Step 1 Complete: PDF generated successfully (XXXXX bytes)

📱 Step 2: Attempting to send ticket via WhatsApp...
✅ Step 2 Complete: Ticket PDF sent via WhatsApp

📧 Step 3: Attempting to send ticket via Email...
✅ Step 3 Complete: Ticket PDF sent via Email
```

## Visual Guide

```
┌─────────────────────────────────────────┐
│  SERVER TERMINAL (Where logs appear)    │
│  ───────────────────────────────────    │
│  $ npm run dev                          │
│  Server running on port 3001           │
│                                         │
│  📧 Starting ticket generation...      │  ← Look here!
│  ✅ PDF generated successfully         │
│  ✅ Ticket sent via WhatsApp           │
│  ✅ Ticket sent via Email              │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│  BROWSER (F12 Console)                  │
│  ───────────────────────────────────    │
│  (This is NOT where server logs appear) │
│  Only shows browser/JavaScript logs    │
└─────────────────────────────────────────┘
```

## If You Don't See Logs

### 1. Check You're Looking at the Right Place
- ✅ Server terminal (where `npm run dev` is running)
- ❌ Browser console (F12)

### 2. Check Server is Running
- Make sure your server is actually running
- Check the terminal shows "Server running on port 3001"

### 3. Check for Errors
- Look for any error messages in server terminal
- Check if booking was actually created

### 4. Verify Booking Has Contact Info
- Booking must have `customer_email` OR `customer_phone`
- Tickets won't be generated if both are missing

## Quick Test

1. **Create a booking** via UI: `http://localhost:5173/fci/book`
2. **Immediately look at your SERVER TERMINAL** (not browser)
3. **Look for** the ticket generation logs shown above

## Still Can't Find Logs?

If you still can't see logs, the ticket generation might not be running. Check:

1. **Server terminal for errors** - Any red error messages?
2. **Booking was created** - Verify booking exists in database
3. **Booking has email/phone** - Required for ticket generation
4. **Server code is correct** - Verify `process.nextTick()` is executing

## Need Help?

Share:
1. Screenshot of your SERVER TERMINAL (not browser)
2. Any error messages you see
3. Whether booking was created successfully
