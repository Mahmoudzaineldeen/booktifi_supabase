// PostgreSQL Database Client (replaces Supabase)
// This file is kept for backward compatibility - use db.ts instead
import { db } from './db';

// Export as supabase for backward compatibility during migration
export const supabase = db;
