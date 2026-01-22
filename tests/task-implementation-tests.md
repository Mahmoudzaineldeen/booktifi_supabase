# Task Implementation Tests

## Test Plan

### TASK 1: Railway Backend ✅
- [ ] Verify `getApiUrl()` returns Railway URL
- [ ] Check no localhost references in production code
- [ ] Test API calls resolve to Railway

### TASK 2: QR Code Structure ✅
- [ ] Verify QR code contains only booking ID
- [ ] Test UUID validation in `/validate-qr` endpoint
- [ ] Test invalid QR codes are rejected

### TASK 3: External vs Internal QR Scanner ✅
- [ ] Test external scanner (public, read-only)
- [ ] Test internal scanner (auth required, modifies state)
- [ ] Verify external scanner doesn't modify booking state

### TASK 4: Camera API QR Scanner ✅
- [ ] Test camera permission handling
- [ ] Test QR code scanning with camera
- [ ] Test manual input fallback
- [ ] Test error handling

### TASK 6: Auto-fill by Phone ✅
- [ ] Test auto-fill when customer exists
- [ ] Test no overwrite of user-entered fields
- [ ] Test behavior when customer not found
