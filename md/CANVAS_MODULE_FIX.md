# Canvas Module Fix

## Problem
Ticket generation was failing with error:
```
Cannot find module '../build/Release/canvas.node'
```

## Root Cause
The `canvas` package requires native bindings that aren't installed. Canvas is only used for barcode generation, not for the main PDF.

## Solution Applied

### File: `server/src/services/pdfService.ts`

1. **Removed top-level canvas import** - Was causing immediate failure
2. **Made canvas loading lazy** - Only loads when barcode generation is needed
3. **Made barcode generation optional** - Tickets work without barcodes
4. **Updated function signature** - `generateBarcodeBuffer` is now async

### Changes:

1. **Lazy Loading Function**
   ```typescript
   async function ensureCanvasLoaded(): Promise<boolean>
   ```
   - Only attempts to load canvas when needed
   - Caches the result to avoid repeated attempts
   - Returns false if canvas is not available

2. **Updated Barcode Function**
   ```typescript
   async function generateBarcodeBuffer(bookingId: string): Promise<Buffer>
   ```
   - Now async to support lazy loading
   - Returns empty buffer if canvas unavailable
   - Tickets still generate successfully

3. **Updated Call Site**
   ```typescript
   const barcodeBuffer = await generateBarcodeBuffer(bookingId);
   ```
   - Now awaits the async function

## Result

✅ **Tickets will now generate successfully** even without canvas
⚠️ **Barcodes will be skipped** if canvas is not available
✅ **QR codes still work** (uses different library)
✅ **PDF generation works** (uses pdfkit, not canvas)

## To Enable Barcodes (Optional)

If you want barcodes on tickets:

1. **Install canvas:**
   ```bash
   cd server
   npm install canvas
   ```

2. **Install system dependencies** (Windows):
   - Install Visual Studio Build Tools
   - Or use pre-built binaries

3. **Restart server** - Canvas will be detected automatically

## Testing

1. **Restart server** to load the fix
2. **Create a booking** - Tickets should generate successfully
3. **Check server logs** - Should see "Canvas module not available" warning
4. **Verify tickets** - PDFs should be generated and sent (without barcodes)

## Expected Behavior

**Without Canvas:**
- ✅ Tickets generate successfully
- ✅ QR codes work
- ⚠️ Barcodes skipped (ticket still valid)
- ✅ Email/WhatsApp delivery works

**With Canvas:**
- ✅ Everything works including barcodes
