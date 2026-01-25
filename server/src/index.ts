import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { supabase } from './db';
import { authRoutes } from './routes/auth';
import { queryRoutes } from './routes/query';
import { customerRoutes } from './routes/customers';
import { reviewRoutes } from './routes/reviews';
import { bookingRoutes } from './routes/bookings';
import { tenantRoutes } from './routes/tenants';
import { employeeRoutes } from './routes/employees';
import { zohoRoutes } from './routes/zoho';
import { packageRoutes } from './routes/packages';
import { startLockCleanup } from './jobs/cleanupLocks';
import { startZohoReceiptWorker } from './jobs/zohoReceiptWorker';
import { startZohoTokenRefresh } from './jobs/zohoTokenRefresh';
import { zohoCredentials } from './config/zohoCredentials';
import { logger } from './utils/logger';

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from server directory (one level up from src)
dotenv.config({ path: join(__dirname, '..', '.env') });

const app = express();
// PORT: Railway uses PORT env var, local dev can use 3001 if needed
// For Railway deployment, PORT is set by Railway (typically 8080 or dynamic)
const PORT = process.env.PORT || (process.env.NODE_ENV === 'production' ? undefined : 3001);

// CORS configuration - Allow all origins for development
// This fixes CORS issues with localhost and ngrok
const corsOptions = {
  origin: true, // Allow all origins
  credentials: true, // Allow cookies and authentication headers
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'ngrok-skip-browser-warning'],
  exposedHeaders: ['Content-Range', 'X-Total-Count'],
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '250mb' })); // Increased payload limit to support 200MB file uploads for service providers and users
app.use(express.urlencoded({ extended: true, limit: '250mb' }));

// Health check (both /health and /api/health for compatibility)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', database: 'connected' });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', database: 'connected' });
});

// Root route handler to prevent "Cannot GET /" error
app.get('/', (req, res) => {
  res.json({
    message: 'Bookati API Server',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: '/health',
      apiHealth: '/api/health',
      auth: '/api/auth',
      customers: '/api/customers',
      bookings: '/api/bookings',
      tenants: '/api/tenants'
    }
  });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/zoho', zohoRoutes);
app.use('/api/packages', packageRoutes);
app.use('/api', queryRoutes);

// Error handler with logging
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  const context = logger.extractContext(req);
  logger.error('Unhandled error', err, context, {
    statusCode: err.status || 500,
    body: req.body,
    query: req.query,
  });
  
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

app.listen(PORT, () => {
  // Check database configuration
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const databaseInfo = supabaseUrl 
    ? supabaseUrl.replace('https://', '').replace('.supabase.co', '')
    : 'Not configured';
  
  logger.info('API Server started', undefined, {
    port: PORT,
    database: databaseInfo,
    environment: process.env.NODE_ENV || 'development',
  });
  console.log(`🚀 API Server running on http://localhost:${PORT}`);
  console.log(`📊 Database: ${databaseInfo}`);
  
  // Check Zoho credentials availability (non-blocking)
  // Credentials are loaded per-tenant from database when needed
  try {
    const globalCreds = zohoCredentials.loadCredentials(false);
    if (globalCreds) {
      console.log(`✅ Zoho global credentials available (fallback)`);
    } else {
      console.log(`ℹ️  Zoho credentials: Will be loaded from database per tenant`);
      console.log(`   Each tenant can configure their own Zoho credentials in Settings → Integrations`);
    }
  } catch (error: any) {
    console.log(`ℹ️  Zoho credentials: Will be loaded from database per tenant`);
    console.log(`   Each tenant can configure their own Zoho credentials in Settings → Integrations`);
  }
  
  // Start background cleanup job for expired booking locks
  startLockCleanup();
  logger.info('Background jobs started', undefined, { job: 'lockCleanup' });
  
  // Start Zoho receipt worker (processes every 30 seconds)
  const zohoWorkerInterval = process.env.ZOHO_WORKER_INTERVAL 
    ? parseInt(process.env.ZOHO_WORKER_INTERVAL) 
    : 30000;
  startZohoReceiptWorker(zohoWorkerInterval);
  logger.info('Background jobs started', undefined, { job: 'zohoReceiptWorker' });
  
  // Start Zoho token refresh worker (runs every 10 minutes)
  // This proactively refreshes tokens before they expire, ensuring they're always valid
  const tokenRefreshInterval = process.env.ZOHO_TOKEN_REFRESH_INTERVAL
    ? parseInt(process.env.ZOHO_TOKEN_REFRESH_INTERVAL)
    : 10 * 60 * 1000; // 10 minutes
  startZohoTokenRefresh(tokenRefreshInterval);
  logger.info('Background jobs started', undefined, { job: 'zohoTokenRefresh' });
  console.log(`🔄 Zoho token auto-refresh enabled (runs every ${tokenRefreshInterval / 1000 / 60} minutes)`);
  console.log(`   Tokens will be refreshed automatically 15 minutes before expiration`);
});
