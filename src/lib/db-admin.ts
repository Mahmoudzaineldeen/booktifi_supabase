// PostgreSQL Admin Client (replaces Supabase Admin)
import { db } from './db';

// For admin operations, use the same client but with admin privileges
// In production, you may want to add additional admin methods or use a different API endpoint
export const dbAdmin = db;
























