import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { supabase } from '../db';
import { sendOTPEmail } from '../services/emailService.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

/**
 * Normalize phone number to international format
 * Handles Egyptian numbers specially: +2001032560826 -> +201032560826 (removes leading 0 after +20)
 * @param phone - Phone number in any format
 * @returns Normalized phone number in E.164 format or null if invalid
 */
function normalizePhoneNumber(phone: string): string | null {
  if (!phone || typeof phone !== 'string') {
    return null;
  }

  // Remove all spaces, dashes, and parentheses
  let cleaned = phone.replace(/[\s\-\(\)]/g, '');

  // If already in international format with +
  if (cleaned.startsWith('+')) {
    // Special handling for Egypt: +2001032560826 -> +201032560826
    if (cleaned.startsWith('+20')) {
      const afterCode = cleaned.substring(3); // Get number after +20
      // If starts with 0, remove it (Egyptian numbers: +2001032560826 -> +201032560826)
      if (afterCode.startsWith('0') && afterCode.length >= 10) {
        const withoutZero = afterCode.substring(1);
        // Validate it's a valid Egyptian mobile number (starts with 1, 2, or 5)
        if (withoutZero.startsWith('1') || withoutZero.startsWith('2') || withoutZero.startsWith('5')) {
          return `+20${withoutZero}`;
        }
      }
      // If already correct format (+201032560826), return as is
      return cleaned;
    }
    // For other countries, return as is
    return cleaned;
  }

  // If starts with 00, replace with +
  if (cleaned.startsWith('00')) {
    cleaned = '+' + cleaned.substring(2);
    // Apply Egypt normalization if needed
    if (cleaned.startsWith('+20')) {
      const afterCode = cleaned.substring(3);
      if (afterCode.startsWith('0') && afterCode.length >= 10) {
        const withoutZero = afterCode.substring(1);
        if (withoutZero.startsWith('1') || withoutZero.startsWith('2') || withoutZero.startsWith('5')) {
          return `+20${withoutZero}`;
        }
      }
    }
    return cleaned;
  }

  // Egyptian numbers: 01XXXXXXXX (11 digits) -> +201XXXXXXXX
  if (cleaned.startsWith('0') && cleaned.length === 11) {
    const withoutZero = cleaned.substring(1);
    if (withoutZero.startsWith('1') || withoutZero.startsWith('2') || withoutZero.startsWith('5')) {
      return `+20${withoutZero}`;
    }
  }

  // If starts with 20 (country code without +), add +
  if (cleaned.startsWith('20') && cleaned.length >= 12) {
    // Check if it has leading 0 after 20 (2001032560826 -> 201032560826)
    const afterCode = cleaned.substring(2);
    if (afterCode.startsWith('0') && afterCode.length >= 10) {
      const withoutZero = afterCode.substring(1);
      if (withoutZero.startsWith('1') || withoutZero.startsWith('2') || withoutZero.startsWith('5')) {
        return `+20${withoutZero}`;
      }
    }
    return `+${cleaned}`;
  }

  // If it's 10 digits starting with 1, 2, or 5 (Egyptian mobile without 0), add +20
  if (cleaned.length === 10 && (cleaned.startsWith('1') || cleaned.startsWith('2') || cleaned.startsWith('5'))) {
    return `+20${cleaned}`;
  }

  // Return null if we can't determine the format
  return null;
}

// Sign in
router.post('/signin', async (req, res) => {
  try {
    const { email, password, username, forCustomer } = req.body;

    if (!email && !username) {
      return res.status(400).json({ error: 'Email or username is required' });
    }

    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    // Find user by email or username
    let userResult;

    if (email) {
      // Try both email and username with the same value
      // Use .select() instead of .maybeSingle() to get all matches, then filter
      const { data: usersByEmail, error: emailError } = await supabase
        .from('users')
        .select('*')
        .eq('email', email);

      if (!emailError && usersByEmail && usersByEmail.length > 0) {
        // If multiple users with same email, prefer tenant_admin > other roles > customer
        // Or if forCustomer is true, prefer customer role
        let selectedUser = null;
        if (forCustomer === true) {
          selectedUser = usersByEmail.find(u => u.role === 'customer') || usersByEmail[0];
        } else {
          // For admin/employee login, prefer tenant_admin, then other non-customer roles
          selectedUser = usersByEmail.find(u => u.role === 'tenant_admin') 
            || usersByEmail.find(u => u.role !== 'customer')
            || usersByEmail[0];
        }
        userResult = { data: selectedUser };
      } else {
        const { data: usersByUsername, error: usernameError } = await supabase
          .from('users')
          .select('*')
          .eq('username', email);
        
        if (!usernameError && usersByUsername && usersByUsername.length > 0) {
          userResult = { data: usersByUsername[0] };
        }
      }
    } else {
      const { data: usersByUsername, error } = await supabase
        .from('users')
        .select('*')
        .eq('username', username);
      
      if (!error && usersByUsername && usersByUsername.length > 0) {
        userResult = { data: usersByUsername[0] };
      }
    }

    if (!userResult || !userResult.data) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = userResult.data;
    
    // Log which user was selected (for debugging duplicate emails)
    if (email) {
      const { data: allUsers } = await supabase
        .from('users')
        .select('id,role')
        .eq('email', email);
      if (allUsers && allUsers.length > 1) {
        console.warn(`[Auth] Multiple users found with email ${email}. Selected user ${user.id} (role: ${user.role})`);
      }
    }

    // Check if user account is active
    if (user.is_active === false) {
      return res.status(403).json({ error: 'Your account has been deactivated. Please contact support.' });
    }

    // SECURITY: Validate role-based access BEFORE password check
    // This prevents information leakage about valid user accounts
    if (forCustomer === true) {
      // Customer login - only allow customers
      if (user.role !== 'customer') {
        console.warn('[Auth] Security: Non-customer attempted customer login', { email: email || username, role: user.role, userId: user.id });
        return res.status(403).json({ error: 'Access denied. This login page is for customers only.' });
      }
    } else {
      // Admin/Service Provider/Employee login - block customers
      if (user.role === 'customer') {
        console.warn('[Auth] Security: Customer attempted admin/employee login', { email: email || username, role: user.role, userId: user.id });
        return res.status(403).json({ error: 'Access denied. Customers cannot login through this page. Please use the customer login page.' });
      }
    }

    // Check password - first check if there's a password_hash column
    // If not, we'll need to add it to the users table
    let passwordMatch = false;
    
    if (user.password_hash) {
      passwordMatch = await bcrypt.compare(password, user.password_hash);
    } else if (user.password) {
      // Fallback for existing passwords (should be migrated)
      passwordMatch = await bcrypt.compare(password, user.password);
    } else {
      // If no password field exists, we need to add it
      return res.status(401).json({ error: 'Password authentication not configured' });
    }

    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Get tenant if exists
    let tenant = null;
    if (user.tenant_id) {
      const { data: tenantData } = await supabase
        .from('tenants')
        .select('*')
        .eq('id', user.tenant_id)
        .maybeSingle();
      tenant = tenantData || null;

      // Check if tenant account is active (for tenant-based roles)
      if (tenant && (user.role === 'tenant_admin' || user.role === 'receptionist' || user.role === 'cashier')) {
        if (tenant.is_active === false) {
          return res.status(403).json({ error: 'This service provider account has been deactivated. Please contact support.' });
        }
      }
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email, 
        role: user.role,
        tenant_id: user.tenant_id 
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Return full user object (excluding password_hash)
    const { password_hash, ...userWithoutPassword } = user;
    
    res.json({
      user: userWithoutPassword,
      tenant,
      session: {
        access_token: token,
        user: {
          id: user.id,
          email: user.email,
        },
      },
    });
  } catch (error: any) {
    console.error('Sign in error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Sign up
router.post('/signup', async (req, res) => {
  try {
    const { email, password, username, full_name, role, tenant_id, phone } = req.body;

    if (!email && !username) {
      return res.status(400).json({ error: 'Email or username is required' });
    }

    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    // full_name is required by the database schema
    if (!full_name || full_name.trim() === '') {
      return res.status(400).json({ error: 'Full name is required' });
    }

    // Check if email already exists (if email provided)
    if (email) {
      const { data: existingUser, error: checkError } = await supabase
        .from('users')
        .select('id, email')
        .eq('email', email)
        .maybeSingle();

      if (checkError && checkError.code !== 'PGRST116') {
        console.error('Error checking existing user:', checkError);
        return res.status(500).json({ error: 'Failed to check if user exists' });
      }

      if (existingUser) {
        return res.status(400).json({ error: 'An account with this email already exists' });
      }
    }

    // Check if username already exists (if username provided)
    if (username) {
      const { data: existingUser, error: checkError } = await supabase
        .from('users')
        .select('id, username')
        .eq('username', username)
        .maybeSingle();

      if (checkError && checkError.code !== 'PGRST116') {
        console.error('Error checking existing user:', checkError);
        return res.status(500).json({ error: 'Failed to check if user exists' });
      }

      if (existingUser) {
        return res.status(400).json({ error: 'An account with this username already exists' });
      }
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user - use crypto.randomUUID() instead of gen_random_uuid()
    const { data: user, error: insertError } = await supabase
      .from('users')
      .insert({
        id: crypto.randomUUID(),
        email: email || null,
        username: username || null,
        full_name: full_name.trim(),
        role: role || 'employee',
        tenant_id: tenant_id || null,
        password_hash: hashedPassword,
        phone: phone || null,
        is_active: true,
      })
      .select()
      .single();

    if (insertError || !user) {
      console.error('Sign up error:', insertError);
      
      // Handle unique constraint violation
      if (insertError?.code === '23505' || insertError?.message?.includes('unique') || insertError?.message?.includes('duplicate')) {
        if (insertError?.message?.includes('email')) {
          return res.status(400).json({ error: 'An account with this email already exists' });
        }
        if (insertError?.message?.includes('username')) {
          return res.status(400).json({ error: 'An account with this username already exists' });
        }
        return res.status(400).json({ error: 'An account with this information already exists' });
      }
      
      return res.status(500).json({ error: insertError?.message || 'Failed to create user' });
    }

    // Generate JWT token with all required fields
    const tokenPayload: {
      id: string;
      email: string | null;
      role: string;
      tenant_id: string | null;
    } = {
      id: user.id,
      email: user.email || null,
      role: user.role || 'employee',
      tenant_id: user.tenant_id || null,
    };

    // Validate required fields
    if (!tokenPayload.id) {
      console.error('[Auth] ❌ Cannot create token: user.id is missing', { user });
      return res.status(500).json({ error: 'User ID is missing. Cannot create authentication token.' });
    }
    if (!tokenPayload.role) {
      console.error('[Auth] ❌ Cannot create token: user.role is missing', { user });
      return res.status(500).json({ error: 'User role is missing. Cannot create authentication token.' });
    }

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '7d' });

    console.log('[Auth] ✅ Signup token created successfully:', {
      userId: tokenPayload.id,
      role: tokenPayload.role,
      hasTenantId: !!tokenPayload.tenant_id,
    });

    res.json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        full_name: user.full_name,
        role: user.role,
      },
      session: {
        access_token: token,
        user: {
          id: user.id,
          email: user.email,
        },
      },
    });
  } catch (error: any) {
    console.error('Sign up error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Sign out
router.post('/signout', async (req, res) => {
  res.json({ message: 'Signed out successfully' });
});

// Get current user
router.get('/user', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'No authorization header' });
    }

    const token = authHeader.replace('Bearer ', '');
    const decoded = jwt.verify(token, JWT_SECRET) as any;

    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', decoded.id)
      .maybeSingle();

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user });
  } catch (error: any) {
    console.error('Get user error:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Refresh token endpoint
router.post('/refresh', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'No authorization header' });
    }

    const token = authHeader.replace('Bearer ', '');
    
    // Verify token (even if expired, we can refresh it)
    let decoded: any;
    try {
      decoded = jwt.verify(token, JWT_SECRET) as any;
    } catch (error: any) {
      // If token is expired, try to decode without verification to get user info
      if (error.name === 'TokenExpiredError') {
        decoded = jwt.decode(token) as any;
        if (!decoded) {
          return res.status(401).json({ error: 'Invalid token' });
        }
      } else {
        return res.status(401).json({ error: 'Invalid token' });
      }
    }

    // Verify user still exists and is active
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', decoded.id)
      .eq('is_active', true)
      .maybeSingle();

    if (!user) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    // Generate new token with validated fields
    const tokenPayload: {
      id: string;
      email: string | null;
      role: string;
      tenant_id: string | null;
    } = {
      id: user.id,
      email: user.email || null,
      role: user.role || 'employee',
      tenant_id: user.tenant_id || null,
    };

    if (!tokenPayload.id || !tokenPayload.role) {
      console.error('[Auth] ❌ Cannot refresh token: missing required fields', { user });
      return res.status(500).json({ error: 'User data incomplete. Cannot refresh token.' });
    }

    const newToken = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '7d' });

    console.log('[Auth] ✅ Token refreshed successfully:', {
      userId: tokenPayload.id,
      role: tokenPayload.role,
      hasTenantId: !!tokenPayload.tenant_id,
    });

    res.json({
      access_token: newToken,
      expires_in: 7 * 24 * 60 * 60, // 7 days in seconds
    });
  } catch (error: any) {
    console.error('Refresh token error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Validate session endpoint
router.get('/validate', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ valid: false, error: 'No authorization header' });
    }

    const token = authHeader.replace('Bearer ', '');
    
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;

      // Verify user still exists and is active
      const { data: user, error } = await supabase
        .from('users')
        .select('id, email, role, tenant_id, is_active')
        .eq('id', decoded.id)
        .maybeSingle();

      if (!user) {
        return res.status(401).json({ valid: false, error: 'User not found' });
      }

      if (!user.is_active) {
        return res.status(401).json({ valid: false, error: 'User is inactive' });
      }

      res.json({ 
        valid: true,
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          tenant_id: user.tenant_id,
        }
      });
    } catch (error: any) {
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({ valid: false, error: 'Token expired', expired: true });
      }
      return res.status(401).json({ valid: false, error: 'Invalid token' });
    }
  } catch (error: any) {
    console.error('Validate session error:', error);
    res.status(500).json({ valid: false, error: error.message || 'Internal server error' });
  }
});

// Update user
router.post('/update', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'No authorization header' });
    }

    const token = authHeader.replace('Bearer ', '');
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const { password } = req.body;

    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      const { error } = await supabase
        .from('users')
        .update({ password_hash: hashedPassword })
        .eq('id', decoded.id);

      if (error) {
        console.error('Update user error:', error);
        return res.status(500).json({ error: error.message });
      }
    }

    res.json({ message: 'User updated successfully' });
  } catch (error: any) {
    console.error('Update user error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generate 6-digit OTP
function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Helper functions for masking
function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return email;
  const [local, domain] = email.split('@');
  if (local.length <= 2) return `${local[0]}***@${domain}`;
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
}

function maskPhone(phone: string): string {
  if (!phone) return phone;
  const clean = phone.replace(/\s/g, '');
  if (clean.startsWith('+')) {
    if (clean.length <= 12) {
      return `${clean.substring(0, 3)}***${clean.substring(clean.length - 4)}`;
    }
    return `${clean.substring(0, 4)}***${clean.substring(clean.length - 5)}`;
  }
  if (clean.length <= 8) {
    return `${clean.substring(0, 2)}***${clean.substring(clean.length - 2)}`;
  }
  return `${clean.substring(0, 3)}***${clean.substring(clean.length - 4)}`;
}

// Lookup user by username, email, or phone and return masked contact info
router.post('/forgot-password/lookup', async (req, res) => {
  try {
    const { identifier, tenant_id } = req.body;

    if (!identifier || !identifier.trim()) {
      return res.status(400).json({ error: 'Username, email, or phone number is required' });
    }

    const trimmedIdentifier = identifier.trim();
    
    // Detect identifier type
    let identifierType: 'email' | 'phone' | 'username' = 'username';
    if (trimmedIdentifier.includes('@')) {
      identifierType = 'email';
    } else if (/^\+?[\d\s-]+$/.test(trimmedIdentifier.replace(/\s/g, ''))) {
      identifierType = 'phone';
    }

    // Find user by detected identifier type
    let user = null;

    if (tenant_id) {
      if (identifierType === 'email') {
        const { data } = await supabase
          .from('users')
          .select('id, email, phone, full_name, tenant_id, username')
          .eq('email', trimmedIdentifier)
          .eq('tenant_id', tenant_id)
          .eq('is_active', true)
          .maybeSingle();
        user = data;
      } else if (identifierType === 'phone') {
        // Normalize phone number for search
        const normalizedPhone = normalizePhoneNumber(trimmedIdentifier);
        if (normalizedPhone) {
          const { data } = await supabase
            .from('users')
            .select('id, email, phone, full_name, tenant_id, username')
            .eq('phone', normalizedPhone)
            .eq('tenant_id', tenant_id)
            .eq('is_active', true)
            .maybeSingle();
          user = data;
        }
      } else {
        // Username
        const { data } = await supabase
          .from('users')
          .select('id, email, phone, full_name, tenant_id, username')
          .eq('username', trimmedIdentifier)
          .eq('tenant_id', tenant_id)
          .eq('is_active', true)
          .maybeSingle();
        user = data;
      }
    } else {
      if (identifierType === 'email') {
        const { data } = await supabase
          .from('users')
          .select('id, email, phone, full_name, tenant_id, username')
          .eq('email', trimmedIdentifier)
          .eq('is_active', true)
          .maybeSingle();
        user = data;
      } else if (identifierType === 'phone') {
        // Normalize phone number for search
        const normalizedPhone = normalizePhoneNumber(trimmedIdentifier);
        if (normalizedPhone) {
          const { data } = await supabase
            .from('users')
            .select('id, email, phone, full_name, tenant_id, username')
            .eq('phone', normalizedPhone)
            .eq('is_active', true)
            .maybeSingle();
          user = data;
        }
      } else {
        // Username
        const { data } = await supabase
          .from('users')
          .select('id, email, phone, full_name, tenant_id, username')
          .eq('username', trimmedIdentifier)
          .eq('is_active', true)
          .maybeSingle();
        user = data;
      }
    }

    // Always return success (security: don't reveal if user exists)
    if (!user) {
      return res.json({
        success: true,
        found: false,
        message: 'If the account exists, you will see your contact information.'
      });
    }

    // Determine display order based on search type
    // If searched by email, show email first; if by phone, show phone first
    const displayOrder = identifierType === 'email' ? ['email', 'phone'] : 
                        identifierType === 'phone' ? ['phone', 'email'] : 
                        ['email', 'phone']; // Default: email first for username

    // Return masked data
    return res.json({
      success: true,
      found: true,
      data: {
        maskedEmail: user.email ? maskEmail(user.email) : null,
        maskedPhone: user.phone ? maskPhone(user.phone) : null,
        hasEmail: !!user.email,
        hasPhone: !!user.phone,
        displayOrder, // Order to display options
        searchType: identifierType, // Type of identifier used for search
        // Include actual values for backend use (will be used internally)
        _email: user.email,
        _phone: user.phone,
        _userId: user.id,
        _tenantId: user.tenant_id,
        _username: user.username,
      }
    });
  } catch (error: any) {
    console.error('Lookup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Request OTP for password reset
router.post('/forgot-password', async (req, res) => {
  try {
    const { identifier, username, email, phone, method = 'email', tenant_id, language = 'en' } = req.body;
    
    console.log('\n📧 ============================================');
    console.log('📧 Forgot Password Request Received');
    console.log('📧 ============================================');
    console.log('   Method:', method);
    console.log('   Identifier:', identifier || username || email || phone);
    console.log('   Tenant ID:', tenant_id);
    console.log('   Language:', language);
    console.log('============================================\n');

    // New flow: support identifier-based lookup (username, email, or phone)
    let userEmail: string | null = email || null;
    let userPhone: string | null = phone || null;
    let userId: string | null = null;
    let userTenantId: string | null = null;
    let searchIdentifier = identifier || username || email || phone;

    // If identifier is provided, lookup user and get their contact info
    if (searchIdentifier) {
      const trimmedIdentifier = searchIdentifier.trim();
      
      // Detect identifier type
      let identifierType: 'email' | 'phone' | 'username' = 'username';
      if (trimmedIdentifier.includes('@')) {
        identifierType = 'email';
      } else if (/^\+?[\d\s-]+$/.test(trimmedIdentifier.replace(/\s/g, ''))) {
        identifierType = 'phone';
      }

      let user = null;
      if (tenant_id) {
        if (identifierType === 'email') {
          const { data } = await supabase
            .from('users')
            .select('id, email, phone, tenant_id')
            .eq('email', trimmedIdentifier)
            .eq('tenant_id', tenant_id)
            .eq('is_active', true)
            .maybeSingle();
          user = data;
        } else if (identifierType === 'phone') {
          const normalizedPhone = normalizePhoneNumber(trimmedIdentifier);
          if (normalizedPhone) {
            const { data } = await supabase
              .from('users')
              .select('id, email, phone, tenant_id')
              .eq('phone', normalizedPhone)
              .eq('tenant_id', tenant_id)
              .eq('is_active', true)
              .maybeSingle();
            user = data;
          }
        } else {
          const { data } = await supabase
            .from('users')
            .select('id, email, phone, tenant_id')
            .eq('username', trimmedIdentifier)
            .eq('tenant_id', tenant_id)
            .eq('is_active', true)
            .maybeSingle();
          user = data;
        }
      } else {
        if (identifierType === 'email') {
          const { data } = await supabase
            .from('users')
            .select('id, email, phone, tenant_id')
            .eq('email', trimmedIdentifier)
            .eq('is_active', true)
            .maybeSingle();
          user = data;
        } else if (identifierType === 'phone') {
          const normalizedPhone = normalizePhoneNumber(trimmedIdentifier);
          if (normalizedPhone) {
            const { data } = await supabase
              .from('users')
              .select('id, email, phone, tenant_id')
              .eq('phone', normalizedPhone)
              .eq('is_active', true)
              .maybeSingle();
            user = data;
          }
        } else {
          const { data } = await supabase
            .from('users')
            .select('id, email, phone, tenant_id')
            .eq('username', trimmedIdentifier)
            .eq('is_active', true)
            .maybeSingle();
          user = data;
        }
      }

      if (!user) {
        // Always return success (security: don't reveal if user exists)
        return res.json({
          success: true,
          message: 'If the account exists, an OTP has been sent.'
        });
      }
      userEmail = user.email;
      userPhone = user.phone;
      userId = user.id;
      userTenantId = user.tenant_id;

      console.log(`\n👤 User found: ${user.id}`);
      console.log(`   Email: ${userEmail || 'not set'}`);
      console.log(`   Phone: ${userPhone || 'not set'}`);
      console.log(`   User tenant_id: ${userTenantId || 'NOT SET ❌'}`);
      console.log(`   Request tenant_id: ${tenant_id || 'not provided'}`);

      // Priority: 1. User's tenant_id, 2. Request tenant_id, 3. Find tenant with SMTP
      if (!userTenantId && tenant_id) {
        console.log(`⚠️  User ${user.id} doesn't have tenant_id, using tenant_id from request: ${tenant_id}`);
        userTenantId = tenant_id;
      }

      // If still no tenant_id, try to find any tenant with SMTP configured (as a fallback)
      if (!userTenantId) {
        console.log(`⚠️  No tenant_id found for user ${user.id}, attempting to find tenant with SMTP configured...`);
        // Try to find any tenant that has SMTP configured (as a fallback)
        const { data: tenantWithSmtp } = await supabase
          .from('tenants')
          .select('id, name, smtp_settings')
          .not('smtp_settings', 'is', null)
          .eq('is_active', true)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (tenantWithSmtp && tenantWithSmtp.smtp_settings?.smtp_user && tenantWithSmtp.smtp_settings?.smtp_password) {
          userTenantId = tenantWithSmtp.id;
          console.log(`✅ Using fallback tenant: ${tenantWithSmtp.name} (${userTenantId}) with SMTP configured`);
        } else {
          console.error(`❌ No tenant with SMTP configured found as fallback`);
        }
      }

      console.log(`   Final tenant_id: ${userTenantId || 'STILL MISSING ❌'}\n`);

      // Validate that the requested method is available
      if (method === 'email' && !userEmail) {
        return res.status(400).json({ 
          error: 'Email not found for this account. Please use WhatsApp method instead.' 
        });
      }
      if (method === 'whatsapp' && !userPhone) {
        return res.status(400).json({ 
          error: 'Phone number not found for this account. Please use email method instead.' 
        });
      }
    }

    // Validate input (for backward compatibility with direct email/phone)
    if (!searchIdentifier && !userEmail && !userPhone) {
      return res.status(400).json({ error: 'Username, email, or phone number is required' });
    }

    if (method && !['email', 'whatsapp'].includes(method)) {
      return res.status(400).json({ error: 'Method must be either "email" or "whatsapp"' });
    }

    const contactIdentifier = userEmail || userPhone;
    const isEmail = !!userEmail;

    // Find user by email or phone (if not already found via username)
    let user = null;
    if (userId) {
      // User already found via username lookup
      const { data } = await supabase
        .from('users')
        .select('id, email, phone, full_name, tenant_id')
        .eq('id', userId)
        .eq('is_active', true)
        .maybeSingle();
      user = data;
    } else if (isEmail) {
      const { data } = await supabase
        .from('users')
        .select('id, email, phone, full_name, tenant_id')
        .eq('email', userEmail)
        .eq('is_active', true)
        .maybeSingle();
      user = data;
    } else if (userPhone) {
      // Normalize phone number for search
      const normalizedPhone = normalizePhoneNumber(userPhone);
      if (normalizedPhone) {
        const { data } = await supabase
          .from('users')
          .select('id, email, phone, full_name, tenant_id')
          .eq('phone', normalizedPhone)
          .eq('is_active', true)
          .maybeSingle();
        user = data;
      }
    }

    // Always return success (security: don't reveal if user exists)
    if (!user) {
      console.log(`⚠️  User not found for ${searchIdentifier ? 'identifier' : (isEmail ? 'email' : 'phone')}: ${searchIdentifier || contactIdentifier}`);
      return res.json({
        success: true,
        message: 'If the ' + (username ? 'username' : (isEmail ? 'email' : 'phone number')) + ' exists, an OTP has been sent.'
      });
    }
    console.log(`✅ User found: ${user.email || user.phone}, Method: ${method}`);
    
    // Use tenant_id from user if not provided
    const finalTenantId = userTenantId || tenant_id || user.tenant_id;

    // For WhatsApp, we need phone number
    if (method === 'whatsapp' && !user.phone && !phone) {
      console.error(`❌ WhatsApp method selected but no phone number available. User phone: ${user.phone}, Request phone: ${phone}`);
      return res.status(400).json({ 
        error: 'Phone number not found for this account. Please use email method instead.' 
      });
    }

    // Generate OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Get tenant WhatsApp settings if method is WhatsApp
    let whatsappConfig: any = null;
    if (method === 'whatsapp') {
      const tenantId = finalTenantId;
      if (tenantId) {
        try {
          const { data: tenantData } = await supabase
            .from('tenants')
            .select('whatsapp_settings')
            .eq('id', tenantId)
            .maybeSingle();

          if (tenantData && tenantData.whatsapp_settings) {
            const settings = tenantData.whatsapp_settings;
            console.log(`\n📱 ============================================`);
            console.log(`📱 Loading WhatsApp Config from Database`);
            console.log(`📱 ============================================`);
            console.log(`   Raw settings:`, JSON.stringify(settings, null, 2));
            
            // Convert snake_case from database to camelCase for whatsappService
            whatsappConfig = {
              provider: settings.provider,
              apiUrl: settings.api_url,
              apiKey: settings.api_key,
              phoneNumberId: settings.phone_number_id,
              accessToken: settings.access_token,
              accountSid: settings.account_sid,
              authToken: settings.auth_token,
              from: settings.from,
            };
            
            console.log(`   Converted config:`, {
              provider: whatsappConfig.provider,
              phoneNumberId: whatsappConfig.phoneNumberId ? 'SET ✅' : 'NOT SET ❌',
              accessToken: whatsappConfig.accessToken ? 'SET ✅' : 'NOT SET ❌',
            });
            console.log(`============================================\n`);
            
            // Ensure provider is set
            if (!whatsappConfig.provider) {
              console.warn('⚠️  WhatsApp settings found but provider not set');
              whatsappConfig = null;
            } else if (!whatsappConfig.accessToken && whatsappConfig.provider === 'meta') {
              console.warn('⚠️  WhatsApp settings found but access_token not set for Meta provider');
              whatsappConfig = null;
            } else {
              console.log(`✅ Using tenant WhatsApp config from database: provider=${whatsappConfig.provider}`);
            }
          }
        } catch (err: any) {
          // If column doesn't exist, that's okay - we'll use default config or fallback to email
          if (err.message?.includes('column') && err.message?.includes('whatsapp_settings')) {
            console.warn('⚠️  whatsapp_settings column may not exist. Please run migration: 20251201000000_add_whatsapp_settings_to_tenants.sql');
          } else {
            console.warn('Could not fetch tenant WhatsApp settings:', err.message);
          }
        }
      }
    }

    // Delete any existing OTPs
    try {
      if (isEmail) {
        await supabase
          .from('otp_requests')
          .delete()
          .eq('email', userEmail)
          .eq('purpose', 'password_reset');
      } else {
        await supabase
          .from('otp_requests')
          .delete()
          .eq('phone', userPhone)
          .eq('purpose', 'password_reset');
      }
    } catch (deleteErr: any) {
      console.warn('⚠️  Error deleting existing OTPs:', deleteErr.message);
      // Continue anyway
    }

    // Store OTP in database
    try {
      if (isEmail) {
        const { error } = await supabase
          .from('otp_requests')
          .insert({
            email: userEmail,
            otp_code: otp,
            expires_at: expiresAt.toISOString(),
            purpose: 'password_reset',
            verified: false,
          });

        if (error) {
          console.error('❌ Failed to insert OTP:', error);
          throw error;
        }
      } else if (userPhone) {
        // Normalize phone number before saving (ensure consistent format)
        // Remove spaces and ensure it starts with +
        const normalizedPhoneForSave = userPhone.trim().replace(/\s/g, '');
        const phoneToSave = normalizedPhoneForSave.startsWith('+')
          ? normalizedPhoneForSave
          : `+${normalizedPhoneForSave}`;

        const { error } = await supabase
          .from('otp_requests')
          .insert({
            phone: phoneToSave,
            otp_code: otp,
            expires_at: expiresAt.toISOString(),
            purpose: 'password_reset',
            verified: false,
          });

        if (error) {
          console.error('❌ Failed to insert OTP:', error);
          throw error;
        }
      }
    } catch (insertErr: any) {
      console.error('❌ Failed to store OTP in database:', insertErr);
      throw new Error('Database error: failed to store OTP. Please try again.');
    }

    // Log OTP in development mode
    if (process.env.NODE_ENV !== 'production') {
      const logIdentifier = contactIdentifier || searchIdentifier || userEmail || userPhone || 'unknown';
      console.log('\n📧 ============================================');
      console.log(`📧 OTP FOR ${logIdentifier.toUpperCase()} (${method.toUpperCase()})`);
      console.log(`📧 CODE: ${otp}`);
      console.log(`📧 Expires at: ${expiresAt.toISOString()}`);
      console.log('📧 ============================================\n');
    }

    // Send OTP via selected method
    if (method === 'whatsapp') {
      try {
        const { sendOTPWhatsApp } = await import('../services/whatsappService.js');
        
        // If no tenant config, sendOTPWhatsApp will use default config or return error
        // Use language from request, default to 'en'
        const otpLanguage = (language === 'ar' ? 'ar' : 'en') as 'en' | 'ar';
        
        // Use the phone number from user record
        // If username was used, user.phone is already set correctly
        let phoneToUse = userPhone || user.phone;
        
        if (!phoneToUse) {
          console.error(`❌ No phone number available for WhatsApp. Request phone: ${phone}, User phone: ${user.phone}`);
          throw new Error('Phone number is required for WhatsApp method');
        }
        
        // If phone is already in international format (+20...), use it directly from DB
        if (phoneToUse.startsWith('+')) {
          console.log(`   ✅ Using phone number directly from DB (international format): ${phoneToUse}`);
        } else {
          // Phone is not in international format, try to convert it
          // This is a fallback - ideally all phones should be stored with + and country code
          console.log(`   ⚠️  Phone number not in international format: ${phoneToUse}`);
          console.log(`   ⚠️  Converting to international format...`);
          
          // Egyptian numbers: 01XXXXXXXX (11 digits) -> +201XXXXXXXX
          if (phoneToUse.startsWith('0') && phoneToUse.length === 11) {
            const withoutZero = phoneToUse.substring(1);
            if (withoutZero.startsWith('1') || withoutZero.startsWith('2') || withoutZero.startsWith('5')) {
              phoneToUse = `+20${withoutZero}`;
              console.log(`   ✅ Converted to international format: ${phoneToUse}`);
            } else {
              phoneToUse = `+20${withoutZero}`;
              console.log(`   ⚠️  Using +20 as default country code: ${phoneToUse}`);
            }
          } else if (phoneToUse.startsWith('20') && phoneToUse.length >= 12) {
            // Starts with 20 but no +
            phoneToUse = `+${phoneToUse}`;
            console.log(`   ✅ Added + prefix: ${phoneToUse}`);
          } else if (phoneToUse.length === 10 && (phoneToUse.startsWith('1') || phoneToUse.startsWith('2') || phoneToUse.startsWith('5'))) {
            // 10 digits starting with 1, 2, or 5 (Egyptian mobile without 0)
            phoneToUse = `+20${phoneToUse}`;
            console.log(`   ✅ Added +20 country code: ${phoneToUse}`);
          } else {
            console.error(`   ❌ Cannot convert phone number format: ${phoneToUse}`);
            console.error(`   Please update phone number in database to international format (+20XXXXXXXXXX)`);
            throw new Error(`Invalid phone number format: ${phoneToUse}. Phone must be in international format (+20XXXXXXXXXX)`);
          }
        }
        
        console.log(`\n📱 ============================================`);
        console.log(`📱 Sending WhatsApp OTP`);
        console.log(`📱 ============================================`);
        console.log(`   Phone to use: ${phoneToUse}`);
        console.log(`   OTP: ${otp}`);
        console.log(`   Language: ${otpLanguage}`);
        console.log(`   WhatsApp Config: ${whatsappConfig ? 'Tenant-specific ✅' : 'Default (from .env)'}`);
        if (whatsappConfig) {
          console.log(`   Provider: ${whatsappConfig.provider}`);
          console.log(`   Phone Number ID: ${whatsappConfig.phoneNumberId || 'NOT SET'}`);
          console.log(`   Access Token: ${whatsappConfig.accessToken ? 'SET ✅' : 'NOT SET ❌'}`);
        } else {
          console.log(`   ⚠️  WhatsApp config not found in database`);
          console.log(`   Please configure WhatsApp settings in tenant settings page`);
        }
        console.log(`============================================\n`);
        
        if (!whatsappConfig) {
          throw new Error('WhatsApp settings not configured in database. Please configure WhatsApp settings in tenant settings.');
        }
        const result = await sendOTPWhatsApp(phoneToUse, otp, otpLanguage, whatsappConfig);
        
        if (result.success) {
          console.log(`✅ OTP WhatsApp sent successfully to ${phoneToUse}`);
          // Continue to send success response at the end
        } else {
          console.error(`❌ Failed to send OTP WhatsApp to ${phoneToUse}:`, result.error);
          
          // Check if it's an access token error
          const isTokenError = result.error?.includes('access token') || 
                              result.error?.includes('invalid') || 
                              result.error?.includes('expired') ||
                              result.error?.includes('session is invalid') ||
                              result.error?.includes('user logged out');
          
          if (isTokenError) {
            console.error(`\n⚠️  WhatsApp Access Token Issue Detected`);
            console.error(`   The access token needs to be refreshed.`);
            console.error(`   Falling back to email automatically...\n`);
            
            // Fallback to email if WhatsApp fails due to token error
            if (user.email) {
              console.log(`📧 Falling back to email for ${user.email}`);
              const emailOtpLanguage = (language === 'ar' ? 'ar' : 'en') as 'en' | 'ar';
              const emailResult = await sendOTPEmail(user.email, otp, user.tenant_id || tenant_id || '', emailOtpLanguage).catch(() => ({ success: false }));
              if (emailResult.success) {
                console.log(`✅ OTP email sent successfully as fallback`);
                // Continue to send success response at the end (OTP was sent via email)
              } else {
                // If email also fails, return error
                return res.status(500).json({ 
                  error: 'Failed to send OTP. Please try again later or contact support.',
                  details: 'Both WhatsApp and email delivery failed.'
                });
              }
            } else {
              // No email available, return error
              return res.status(500).json({ 
                error: 'WhatsApp service is currently unavailable and no email is available. Please contact support.',
                details: 'WhatsApp access token needs to be refreshed.'
              });
            }
          } else {
            // For other errors (not token-related), try email fallback
            console.error(`   WhatsApp sending failed. Trying email fallback...`);
            if (user.email) {
              console.log(`📧 Falling back to email for ${user.email}`);
              const emailOtpLanguage = (language === 'ar' ? 'ar' : 'en') as 'en' | 'ar';
              const emailResult = await sendOTPEmail(user.email, otp, user.tenant_id || tenant_id || '', emailOtpLanguage).catch(() => ({ success: false }));
              if (emailResult.success) {
                console.log(`✅ OTP email sent successfully as fallback`);
                // Continue to send success response at the end (OTP was sent via email)
              } else {
                return res.status(500).json({ 
                  error: 'Failed to send OTP. Please try again later or contact support.',
                  details: result.error
                });
              }
            } else {
              return res.status(500).json({ 
                error: 'Failed to send OTP via WhatsApp. Please try again later or contact support.',
                details: result.error
              });
            }
          }
        }
      } catch (importErr: any) {
        console.error('❌ Failed to import or send WhatsApp OTP:', importErr);
        console.error('   Error details:', importErr.message);
        console.error('   Stack:', importErr.stack);
        
        // Try email fallback if WhatsApp import fails
        if (user.email) {
          console.log(`📧 Falling back to email for ${user.email}`);
          const emailOtpLanguage = (language === 'ar' ? 'ar' : 'en') as 'en' | 'ar';
          const fallbackTenantId = user.tenant_id || tenant_id || finalTenantId || '';
          const emailResult = await sendOTPEmail(user.email, otp, fallbackTenantId, emailOtpLanguage).catch(() => ({ success: false }));
          if (emailResult.success) {
            console.log(`✅ OTP email sent successfully as fallback`);
            // Continue to send success response at the end (OTP was sent via email)
          } else {
            return res.status(500).json({ 
              error: 'Failed to send OTP. Please try again later or contact support.',
              details: 'Both WhatsApp and email delivery failed.'
            });
          }
        } else {
          return res.status(500).json({ 
            error: 'WhatsApp service is currently unavailable and no email is available. Please contact support.',
            details: 'Failed to initialize WhatsApp service.'
          });
        }
      }
    } else {
      // Send email (don't await - send in background)
      const otpLanguage = (language === 'ar' ? 'ar' : 'en') as 'en' | 'ar';
      const finalTenantId = userTenantId || tenant_id;
      
      if (!finalTenantId) {
        console.error(`❌ Cannot send OTP email: tenant_id is missing`);
        console.error(`   User tenant_id: ${userTenantId || 'not set'}`);
        console.error(`   Request tenant_id: ${tenant_id || 'not set'}`);
        console.error(`   Email: ${user.email || email}`);
        console.error(`   OTP: ${otp} (stored in database)`);
        if (process.env.NODE_ENV !== 'production') {
          console.log(`⚠️  OTP is still stored in database. Check console above for the code.`);
        }
      } else {
        console.log(`📧 Sending OTP email to ${user.email || email} for tenant ${finalTenantId}`);
        sendOTPEmail(user.email || email, otp, finalTenantId, otpLanguage).then(result => {
        if (result.success) {
          console.log(`✅ OTP email sent to ${user.email || email}`);
        } else {
          console.error(`❌ Failed to send OTP email to ${user.email || email}:`, result.error);
          if (process.env.NODE_ENV !== 'production') {
            console.log(`⚠️  OTP is still stored in database. Check console above for the code.`);
          }
        }
      }).catch(err => {
        console.error('❌ Failed to send OTP email:', err);
        if (process.env.NODE_ENV !== 'production') {
          console.log(`⚠️  OTP is still stored in database. Check console above for the code.`);
        }
      });
      }
    }

    res.json({ 
      success: true, 
      message: `If the ${isEmail ? 'email' : 'phone number'} exists, an OTP has been sent via ${method}.` 
    });
  } catch (error: any) {
    console.error('❌ Forgot password error:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      code: error.code
    });
    
    // Provide more helpful error messages
    let errorMessage = 'Internal server error';
    if (error.message?.includes('column') && error.message?.includes('email')) {
      errorMessage = 'Database migration not applied. Please run: 20251203000000_add_email_otp_support.sql';
    } else if (error.message?.includes('column') && error.message?.includes('whatsapp_settings')) {
      errorMessage = 'Database migration not applied. Please run: 20251201000000_add_whatsapp_settings_to_tenants.sql';
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    res.status(500).json({ 
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Verify OTP
router.post('/verify-otp', async (req, res) => {
  try {
    const { username, email, phone, identifier, otp, method, tenant_id } = req.body;

    console.log('\n🔐 ============================================');
    console.log('🔐 Verify OTP Request Received');
    console.log('🔐 ============================================');
    console.log('   OTP:', otp);
    console.log('   Method:', method);
    console.log('   Identifier:', identifier || username || email || phone);
    console.log('   Tenant ID:', tenant_id);
    console.log('============================================\n');

    if (!otp) {
      console.error('❌ OTP verification failed: OTP is required');
      return res.status(400).json({ error: 'OTP is required' });
    }

    // Support identifier-based lookup (username, email, or phone)
    let userEmail = email;
    let userPhone = phone;
    let isEmail = !!email;
    let searchIdentifier = identifier || username || email || phone;
    
    if (!searchIdentifier && !email && !phone) {
      console.error('❌ OTP verification failed: No identifier provided');
      return res.status(400).json({ error: 'Identifier, email, or phone number is required' });
    }

    if (searchIdentifier && !email && !phone) {
      // Need to lookup user by identifier
      let user = null;

      // Detect identifier type
      const isEmailIdentifier = searchIdentifier.includes('@');
      const isPhoneIdentifier = /^[\d\s\+\-\(\)]+$/.test(searchIdentifier.replace(/\s/g, ''));

      if (tenant_id) {
        if (isEmailIdentifier) {
          const { data } = await supabase
            .from('users')
            .select('id, email, phone, username')
            .eq('email', searchIdentifier)
            .eq('tenant_id', tenant_id)
            .eq('is_active', true)
            .maybeSingle();
          user = data;
        } else if (isPhoneIdentifier) {
          // Normalize phone for search
          const normalizedPhone = normalizePhoneNumber(searchIdentifier);
          if (normalizedPhone) {
            const { data } = await supabase
              .from('users')
              .select('id, email, phone, username')
              .eq('phone', normalizedPhone)
              .eq('tenant_id', tenant_id)
              .eq('is_active', true)
              .maybeSingle();
            user = data;
          }
        } else {
          // Username
          const { data } = await supabase
            .from('users')
            .select('id, email, phone, username')
            .eq('username', searchIdentifier)
            .eq('tenant_id', tenant_id)
            .eq('is_active', true)
            .maybeSingle();
          user = data;
        }
      } else {
        if (isEmailIdentifier) {
          const { data } = await supabase
            .from('users')
            .select('id, email, phone, username')
            .eq('email', searchIdentifier)
            .eq('is_active', true)
            .maybeSingle();
          user = data;
        } else if (isPhoneIdentifier) {
          // Normalize phone for search
          const normalizedPhone = normalizePhoneNumber(searchIdentifier);
          if (normalizedPhone) {
            const { data } = await supabase
              .from('users')
              .select('id, email, phone, username')
              .eq('phone', normalizedPhone)
              .eq('is_active', true)
              .maybeSingle();
            user = data;
          }
        } else {
          // Username
          const { data } = await supabase
            .from('users')
            .select('id, email, phone, username')
            .eq('username', searchIdentifier)
            .eq('is_active', true)
            .maybeSingle();
          user = data;
        }
      }

      if (!user) {
        console.error('❌ User not found for identifier:', searchIdentifier);
        return res.status(400).json({ error: 'Invalid OTP' });
      }
      console.log('✅ User found:', {
        id: user.id,
        email: user.email ? 'SET ✅' : 'NOT SET ❌',
        phone: user.phone ? 'SET ✅' : 'NOT SET ❌',
        username: user.username || 'N/A'
      });
      
      // Always get both email and phone from user record for OTP search
      // We'll use method to determine which one to prioritize, but search both
      userEmail = user.email || null;
      userPhone = user.phone || null;
      
      // Use method to determine which contact info to prioritize for OTP search
      if (method === 'email') {
        isEmail = true;
        console.log('   Using email method (will search email first):', userEmail);
      } else if (method === 'whatsapp') {
        isEmail = false;
        console.log('   Using WhatsApp method (will search phone first):', userPhone);
      } else {
        // Default: prioritize email if available, otherwise phone
        isEmail = !!user.email;
        console.log('   Using default method (will search both):', {
          email: userEmail || 'N/A',
          phone: userPhone || 'N/A',
          priority: isEmail ? 'email' : 'phone'
        });
      }
    }

    if (!userEmail && !userPhone) {
      console.error('❌ No email or phone available for OTP verification');
      return res.status(400).json({ error: 'Email or phone number is required' });
    }

    const contactIdentifier = userEmail || userPhone;

    // Determine which method to use for OTP search
    // Always try both email and phone if available, but prioritize based on method
    // This ensures we find OTP even if it was sent via a different method than selected
    const useEmailForOTPSearch = userEmail ? true : false;
    const usePhoneForOTPSearch = userPhone ? true : false;
    const searchEmailFirst = method === 'email' || (method !== 'whatsapp' && userEmail);
    const searchPhoneFirst = method === 'whatsapp' || (method !== 'email' && userPhone);

    console.log('🔍 OTP Search Strategy:', {
      method: method || 'not specified',
      useEmailForOTPSearch,
      usePhoneForOTPSearch,
      userEmail: userEmail ? 'SET ✅' : 'NOT SET ❌',
      userPhone: userPhone ? 'SET ✅' : 'NOT SET ❌',
    });

    // Find valid OTP
    let otpRecord: any = null;
    try {
      // Search strategy: Try the method specified first, then try the other method as fallback
      // This ensures we find OTP even if it was sent via a different method

      // Try email first if method is email or if email is available and method is not whatsapp
      if (searchEmailFirst && useEmailForOTPSearch && userEmail) {
        console.log('   🔍 Searching OTP by email first (method: email or default)...');
        const { data } = await supabase
          .from('otp_requests')
          .select('id, email, expires_at, verified')
          .eq('email', userEmail)
          .eq('otp_code', otp)
          .eq('purpose', 'password_reset')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        otpRecord = data;
        console.log('   ✅ Email OTP search completed');
      }

      // If email search didn't find OTP, try phone (either as primary for whatsapp method or as fallback)
      if (!otpRecord && usePhoneForOTPSearch && userPhone) {
        if (searchPhoneFirst) {
          console.log('   🔍 Searching OTP by phone first (method: whatsapp)...');
        } else {
          console.log('   🔄 Trying phone OTP search as fallback...');
        }
        // Normalize phone number for search
        const normalizedPhone = normalizePhoneNumber(userPhone);
        if (normalizedPhone) {
          const { data } = await supabase
            .from('otp_requests')
            .select('id, phone, expires_at, verified')
            .eq('phone', normalizedPhone)
            .eq('otp_code', otp)
            .eq('purpose', 'password_reset')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          otpRecord = data;
        }
        console.log('   ✅ Phone OTP search completed');
      }

      // If phone search didn't find OTP and email search is available, try email as final fallback
      if (!otpRecord && useEmailForOTPSearch && userEmail && !searchEmailFirst) {
        console.log('   🔄 Trying email OTP search as final fallback...');
        const { data } = await supabase
          .from('otp_requests')
          .select('id, email, expires_at, verified')
          .eq('email', userEmail)
          .eq('otp_code', otp)
          .eq('purpose', 'password_reset')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        otpRecord = data;
        console.log('   ✅ Email OTP search completed (fallback)');
      }
    } catch (queryErr: any) {
      console.error('❌ Error searching for OTP:', queryErr);
      throw queryErr;
    }

    if (!otpRecord) {
      console.error('❌ OTP verification failed: No OTP found');
      console.error('   Search details:', {
        isEmail,
        userEmail: userEmail ? `SET ✅ (${userEmail})` : 'NOT SET ❌',
        userPhone: userPhone ? `SET ✅ (${userPhone})` : 'NOT SET ❌',
        otp: otp ? `SET ✅ (${otp})` : 'NOT SET ❌',
        searchIdentifier: searchIdentifier || 'N/A',
      });
      return res.status(400).json({ error: 'Invalid OTP. Please check the code and try again.' });
    }
    
    if (!otpRecord) {
      console.error('❌ OTP verification failed: OTP record is null');
      return res.status(400).json({ error: 'Invalid OTP' });
    }

    // Check if expired
    if (new Date(otpRecord.expires_at) < new Date()) {
      return res.status(400).json({ error: 'OTP has expired' });
    }

    // Check if already verified
    if (otpRecord.verified) {
      return res.status(400).json({ error: 'OTP has already been used' });
    }

    // Mark as verified
    const { error: updateError } = await supabase
      .from('otp_requests')
      .update({ verified: true })
      .eq('id', otpRecord.id);

    if (updateError) {
      console.error('❌ Failed to mark OTP as verified:', updateError);
    }

    // Get email/phone from OTP record (prefer OTP record, fallback to user lookup result)
    const otpEmail = otpRecord.email || (isEmail ? userEmail : null);
    const otpPhone = otpRecord.phone || (!isEmail ? userPhone : null);

    // Generate temporary token for password reset (valid for 15 minutes)
    const resetToken = jwt.sign(
      {
        email: otpEmail,
        phone: otpPhone,
        identifier: searchIdentifier || contactIdentifier,
        otpId: otpRecord.id,
        purpose: 'password_reset'
      },
      JWT_SECRET,
      { expiresIn: '15m' }
    );

    // Get user info for automatic login
    let user = null;
    if (otpEmail) {
      const { data } = await supabase
        .from('users')
        .select('*')
        .eq('email', otpEmail)
        .eq('is_active', true)
        .maybeSingle();
      user = data;
    } else if (otpPhone) {
      const normalizedPhone = normalizePhoneNumber(otpPhone);
      if (normalizedPhone) {
        const { data } = await supabase
          .from('users')
          .select('*')
          .eq('phone', normalizedPhone)
          .eq('is_active', true)
          .maybeSingle();
        user = data;
      }
    }

    let tenant = null;
    let sessionToken = null;

    if (user) {
      // Get tenant if exists
      if (user.tenant_id) {
        const { data: tenantData } = await supabase
          .from('tenants')
          .select('*')
          .eq('id', user.tenant_id)
          .maybeSingle();
        tenant = tenantData || null;
      }

      // Generate JWT session token for automatic login
      const tokenPayload: {
        id: string;
        email: string | null;
        role: string;
        tenant_id: string | null;
      } = {
        id: user.id,
        email: user.email || null,
        role: user.role || 'employee',
        tenant_id: user.tenant_id || null,
      };

      if (!tokenPayload.id || !tokenPayload.role) {
        console.error('[Auth] ❌ Cannot create OTP session token: missing required fields', { user });
      } else {
        sessionToken = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '7d' });
        console.log('[Auth] ✅ OTP session token created:', {
          userId: tokenPayload.id,
          role: tokenPayload.role,
          hasTenantId: !!tokenPayload.tenant_id,
        });
      }

      // Remove password from user object
      const { password_hash, password, ...userWithoutPassword } = user;
      
      console.log('✅ User authenticated via OTP:', {
        id: user.id,
        email: user.email,
        role: user.role,
        tenant_id: user.tenant_id || 'N/A'
      });
    }

    res.json({ 
      success: true, 
      resetToken,
      message: 'OTP verified successfully',
      // Include session info for automatic login
      ...(sessionToken && {
        session: {
          access_token: sessionToken,
          user: {
            id: user.id,
            email: user.email,
            role: user.role,
            tenant_id: user.tenant_id
          }
        },
        user: user ? (() => {
          const { password_hash, password, ...rest } = user;
          return rest;
        })() : null,
        tenant
      })
    });
  } catch (error: any) {
    console.error('Verify OTP error:', error);
    console.error('Error details:', error.message);
    console.error('Stack:', error.stack);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message || 'An unexpected error occurred'
    });
  }
});

// Reset password (with token from OTP verification)
router.post('/reset-password', async (req, res) => {
  try {
    const { resetToken, newPassword } = req.body;

    if (!resetToken || !newPassword) {
      return res.status(400).json({ error: 'Reset token and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Verify token
    let decoded: any;
    try {
      decoded = jwt.verify(resetToken, JWT_SECRET) as any;
    } catch (error: any) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    if (decoded.purpose !== 'password_reset') {
      return res.status(400).json({ error: 'Invalid token purpose' });
    }

    // Verify OTP was actually verified
    const { data: otpData } = await supabase
      .from('otp_requests')
      .select('verified')
      .eq('id', decoded.otpId)
      .maybeSingle();

    if (!otpData || !otpData.verified) {
      return res.status(400).json({ error: 'OTP not verified' });
    }

    // Get identifier (email or phone) from decoded token
    const identifier = decoded.email || decoded.phone || decoded.identifier;
    
    if (!identifier) {
      return res.status(400).json({ error: 'Invalid reset token: missing identifier' });
    }

    // Update password - find user by email or phone
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    let updateError = null;

    if (decoded.email) {
      const { error } = await supabase
        .from('users')
        .update({ password_hash: hashedPassword })
        .eq('email', decoded.email);
      updateError = error;
    } else if (decoded.phone) {
      // Normalize phone number for search
      const normalizedPhone = normalizePhoneNumber(decoded.phone);
      if (normalizedPhone) {
        const { error } = await supabase
          .from('users')
          .update({ password_hash: hashedPassword })
          .eq('phone', normalizedPhone);
        updateError = error;
      } else {
        return res.status(400).json({ error: 'Invalid phone number format' });
      }
    } else {
      return res.status(400).json({ error: 'Invalid reset token: missing email or phone' });
    }

    if (updateError) {
      console.error('Failed to update password:', updateError);
      return res.status(500).json({ error: 'Failed to update password' });
    }

    // Invalidate all OTPs
    if (decoded.email) {
      await supabase
        .from('otp_requests')
        .update({ verified: true })
        .eq('email', decoded.email)
        .eq('purpose', 'password_reset');
    } else if (decoded.phone) {
      // Normalize phone number for search
      const normalizedPhone = normalizePhoneNumber(decoded.phone);
      if (normalizedPhone) {
        await supabase
          .from('otp_requests')
          .update({ verified: true })
          .eq('phone', normalizedPhone)
          .eq('purpose', 'password_reset');
      }
    }

    res.json({ success: true, message: 'Password reset successfully' });
  } catch (error: any) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login with OTP (continue without changing password)
router.post('/login-with-otp', async (req, res) => {
  try {
    const { resetToken } = req.body;

    if (!resetToken) {
      return res.status(400).json({ error: 'Reset token is required' });
    }

    // Verify token
    let decoded: any;
    try {
      decoded = jwt.verify(resetToken, JWT_SECRET) as any;
    } catch (error: any) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    if (decoded.purpose !== 'password_reset') {
      return res.status(400).json({ error: 'Invalid token purpose' });
    }

    // Get identifier (email or phone) from decoded token
    const identifier = decoded.email || decoded.phone || decoded.identifier;
    
    if (!identifier) {
      return res.status(400).json({ error: 'Invalid reset token: missing identifier' });
    }

    // Get user by email or phone
    let user = null;
    if (decoded.email) {
      const { data } = await supabase
        .from('users')
        .select('*')
        .eq('email', decoded.email)
        .eq('is_active', true)
        .maybeSingle();
      user = data;
    } else if (decoded.phone) {
      // Normalize phone number for search
      const normalizedPhone = normalizePhoneNumber(decoded.phone);
      if (normalizedPhone) {
        const { data } = await supabase
          .from('users')
          .select('*')
          .eq('phone', normalizedPhone)
          .eq('is_active', true)
          .maybeSingle();
        user = data;
      }
    } else {
      return res.status(400).json({ error: 'Invalid reset token: missing email or phone' });
    }

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get tenant if exists
    let tenant = null;
    if (user.tenant_id) {
      const { data: tenantData } = await supabase
        .from('tenants')
        .select('*')
        .eq('id', user.tenant_id)
        .maybeSingle();
      tenant = tenantData || null;
    }

    // Generate JWT token for login with validated fields
    const tokenPayload: {
      id: string;
      email: string | null;
      role: string;
      tenant_id: string | null;
    } = {
      id: user.id,
      email: user.email || null,
      role: user.role || 'employee',
      tenant_id: user.tenant_id || null,
    };

    if (!tokenPayload.id || !tokenPayload.role) {
      console.error('[Auth] ❌ Cannot create login token: missing required fields', { user });
      return res.status(500).json({ error: 'User data incomplete. Cannot create authentication token.' });
    }

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '7d' });

    console.log('[Auth] ✅ Login with OTP token created:', {
      userId: tokenPayload.id,
      role: tokenPayload.role,
      hasTenantId: !!tokenPayload.tenant_id,
    });

    // Remove sensitive fields from user object
    const { password_hash, password, ...userWithoutPassword } = user;

    res.json({
      user: userWithoutPassword,
      tenant: tenant ? {
        id: tenant.id,
        name: tenant.name,
        name_ar: tenant.name_ar,
        slug: tenant.slug,
        industry: tenant.industry,
        contact_email: tenant.contact_email,
        contact_phone: tenant.contact_phone,
        tenant_time_zone: tenant.tenant_time_zone,
        is_active: tenant.is_active,
        public_page_enabled: tenant.public_page_enabled,
        maintenance_mode: tenant.maintenance_mode
      } : null,
      session: {
        access_token: token,
        user: {
          id: user.id,
          email: user.email,
          username: user.username
        },
      },
    });
  } catch (error: any) {
    console.error('Login with OTP error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Check if phone number exists (for phone entry page)
router.post('/check-phone', async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    // Normalize phone number
    const normalizedPhone = normalizePhoneNumber(phone);
    if (!normalizedPhone) {
      return res.status(400).json({ error: 'Invalid phone number format' });
    }

    // Check if phone exists in users table (customers)
    const { data: user } = await supabase
      .from('users')
      .select('id, email, phone, full_name')
      .eq('phone', normalizedPhone)
      .eq('role', 'customer')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (user) {
      return res.json({
        exists: true,
        email: user.email || null,
        name: user.full_name || null,
      });
    }

    // Check if phone exists in bookings table (guest bookings)
    const { data: booking } = await supabase
      .from('bookings')
      .select('customer_name, customer_email')
      .eq('customer_phone', normalizedPhone)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (booking) {
      return res.json({
        exists: true,
        email: booking.customer_email || null,
        name: booking.customer_name || null,
      });
    }

    // Phone not found
    return res.json({
      exists: false,
    });
  } catch (error: any) {
    console.error('Error checking phone:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Guest phone verification endpoint (for booking without account)
router.post('/guest/verify-phone', async (req, res) => {
  try {
    const { phone, tenant_id } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    // Normalize phone number
    const normalizedPhone = normalizePhoneNumber(phone);
    if (!normalizedPhone) {
      return res.status(400).json({ error: 'Invalid phone number format' });
    }

    // Check if phone number already exists in bookings (for uniqueness check)
    // We allow same phone for different tenants, but check within tenant if tenant_id provided
    let phoneExists = false;
    if (tenant_id) {
      const { data } = await supabase
        .from('bookings')
        .select('id')
        .eq('customer_phone', normalizedPhone)
        .eq('tenant_id', tenant_id)
        .limit(1)
        .maybeSingle();
      phoneExists = !!data;
    } else {
      const { data } = await supabase
        .from('bookings')
        .select('id')
        .eq('customer_phone', normalizedPhone)
        .limit(1)
        .maybeSingle();
      phoneExists = !!data;
    }

    // Phone uniqueness: For guest bookings, we allow same phone but track it
    // This is informational, not blocking

    // Generate and send OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store OTP in database
    const { error: insertError } = await supabase
      .from('otp_requests')
      .insert({
        phone: normalizedPhone,
        otp_code: otp,
        expires_at: expiresAt.toISOString(),
        purpose: 'guest_verification',
        verified: false,
      });

    if (insertError) {
      console.error('Failed to insert OTP:', insertError);
      return res.status(500).json({ error: 'Failed to generate OTP' });
    }

    // Send OTP via WhatsApp
    try {
      const { sendOTPWhatsApp } = await import('../services/whatsappService.js');
      
      // Get tenant WhatsApp settings if tenant_id provided
      let whatsappConfig: any = null;
      if (tenant_id) {
        try {
          const { data: tenantData, error: tenantError } = await supabase
            .from('tenants')
            .select('whatsapp_settings')
            .eq('id', tenant_id)
            .maybeSingle();

          if (tenantError) {
            console.error('❌ Error fetching tenant WhatsApp settings:', tenantError.message);
            console.error('   Tenant ID:', tenant_id);
          } else if (tenantData && tenantData.whatsapp_settings) {
            const settings = tenantData.whatsapp_settings;
            whatsappConfig = {
              provider: settings.provider,
              apiUrl: settings.api_url,
              apiKey: settings.api_key,
              phoneNumberId: settings.phone_number_id,
              accessToken: settings.access_token,
              accountSid: settings.account_sid,
              authToken: settings.auth_token,
              from: settings.from,
            };
            
            // Validate config has required fields
            if (whatsappConfig.provider === 'meta' && (!whatsappConfig.phoneNumberId || !whatsappConfig.accessToken)) {
              console.warn('⚠️  WhatsApp settings found but missing required fields for Meta provider');
              console.warn('   Required: phone_number_id, access_token');
              whatsappConfig = null;
            } else if (whatsappConfig.provider && whatsappConfig.phoneNumberId && whatsappConfig.accessToken) {
              console.log(`✅ WhatsApp config loaded for tenant ${tenant_id}: provider=${whatsappConfig.provider}`);
            }
          } else {
            console.warn(`⚠️  Tenant ${tenant_id} found but whatsapp_settings is null or empty`);
          }
        } catch (err: any) {
          console.error('❌ Exception fetching tenant WhatsApp settings:', err.message);
          console.error('   Tenant ID:', tenant_id);
          if (err.stack) console.error('   Stack:', err.stack);
        }
      } else {
        console.warn('⚠️  No tenant_id provided in request - cannot fetch WhatsApp settings');
      }

      if (!whatsappConfig) {
        console.error('❌ WhatsApp settings not configured in database for tenant');
        if (tenant_id) {
          console.error(`   Tenant ID: ${tenant_id}`);
          console.error('   Please configure WhatsApp settings in tenant settings page');
        } else {
          console.error('   tenant_id was not provided in the request');
        }
        // Still return success, OTP is stored in DB
        return res.json({ success: true, message: 'OTP generated. WhatsApp not configured.' });
      }
      const result = await sendOTPWhatsApp(normalizedPhone, otp, 'en', whatsappConfig);
      
      if (!result.success) {
        console.error('Failed to send WhatsApp OTP:', result.error);
        // Still return success, OTP is stored in DB
      }
    } catch (importErr: any) {
      console.error('Failed to send WhatsApp OTP:', importErr);
      // Still return success, OTP is stored in DB
    }

    // Log OTP in development mode
    if (process.env.NODE_ENV !== 'production') {
      console.log('\n📧 ============================================');
      console.log(`📧 GUEST OTP FOR ${normalizedPhone.toUpperCase()}`);
      console.log(`📧 CODE: ${otp}`);
      console.log(`📧 Expires at: ${expiresAt.toISOString()}`);
      console.log('📧 ============================================\n');
    }

    res.json({
      success: true,
      message: 'OTP sent successfully',
      phoneExists, // Informational: phone was used before
    });
  } catch (error: any) {
    console.error('Guest phone verification error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Verify guest OTP
router.post('/guest/verify-otp', async (req, res) => {
  try {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({ error: 'Phone number and OTP are required' });
    }

    // Normalize phone number
    const normalizedPhone = normalizePhoneNumber(phone);
    if (!normalizedPhone) {
      return res.status(400).json({ error: 'Invalid phone number format' });
    }

    // Find valid OTP
    const { data: otpRecord } = await supabase
      .from('otp_requests')
      .select('id, phone, expires_at, verified')
      .eq('phone', normalizedPhone)
      .eq('otp_code', otp)
      .eq('purpose', 'guest_verification')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!otpRecord) {
      return res.status(400).json({ error: 'Invalid OTP' });
    }

    // Check if expired
    if (new Date(otpRecord.expires_at) < new Date()) {
      return res.status(400).json({ error: 'OTP has expired' });
    }

    // Check if already verified
    if (otpRecord.verified) {
      return res.status(400).json({ error: 'OTP has already been used' });
    }

    // Mark as verified
    const { error: updateError } = await supabase
      .from('otp_requests')
      .update({ verified: true })
      .eq('id', otpRecord.id);

    if (updateError) {
      console.error('Failed to mark OTP as verified:', updateError);
    }

    res.json({
      success: true,
      message: 'Phone verified successfully',
      verifiedPhone: normalizedPhone,
    });
  } catch (error: any) {
    console.error('Guest OTP verification error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Middleware to authenticate solution owner only
function authenticateSolutionOwner(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Authorization header required' });
    }

    const token = authHeader.replace('Bearer ', '');
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    
    if (decoded.role !== 'solution_owner') {
      return res.status(403).json({ 
        error: 'Access denied. Only Solution Owner can perform this action.',
        userRole: decoded.role
      });
    }

    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      tenant_id: decoded.tenant_id,
    };
    
    next();
  } catch (error: any) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Create Solution Owner (only accessible by existing Solution Owner)
router.post('/create-solution-owner', authenticateSolutionOwner, async (req, res) => {
  try {
    const { email, password, full_name } = req.body;

    if (!email || !password || !full_name) {
      return res.status(400).json({ 
        error: 'Email, password, and full name are required' 
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Validate password strength
    if (password.length < 8) {
      return res.status(400).json({ 
        error: 'Password must be at least 8 characters long' 
      });
    }

    // Check if user already exists
    const { data: existingUser, error: checkError } = await supabase
      .from('users')
      .select('id, email')
      .eq('email', email)
      .maybeSingle();

    if (checkError && checkError.code !== 'PGRST116') {
      console.error('Error checking existing user:', checkError);
      return res.status(500).json({ error: 'Failed to check if user exists' });
    }

    if (existingUser) {
      return res.status(400).json({ error: 'An account with this email already exists' });
    }

    // Step 1: Create Supabase Auth user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: email,
      password: password,
      email_confirm: true,
      user_metadata: {
        full_name: full_name,
        role: 'solution_owner'
      }
    });

    if (authError) {
      console.error('Error creating auth user:', authError);
      return res.status(500).json({ 
        error: `Failed to create auth user: ${authError.message}` 
      });
    }

    if (!authData.user) {
      return res.status(500).json({ error: 'Failed to create auth user: No user returned' });
    }

    const authUserId = authData.user.id;

    // Step 2: Hash password for password_hash column
    const passwordHash = await bcrypt.hash(password, 10);

    // Step 3: Create user profile in users table
    const { data: userProfile, error: profileError } = await supabase
      .from('users')
      .insert({
        id: authUserId,
        email: email,
        full_name: full_name.trim(),
        role: 'solution_owner',
        is_active: true,
        tenant_id: null, // CRITICAL: Solution Owner has NULL tenant_id for system-wide access
        password_hash: passwordHash // Store hashed password
      })
      .select('id, email, full_name, role, tenant_id, is_active')
      .single();

    if (profileError) {
      // If profile creation fails, try to delete the auth user
      try {
        await supabase.auth.admin.deleteUser(authUserId);
      } catch (deleteError) {
        console.error('Error cleaning up auth user after profile creation failure:', deleteError);
      }

      console.error('Error creating user profile:', profileError);
      return res.status(500).json({ 
        error: `Failed to create user profile: ${profileError.message}` 
      });
    }

    // Step 4: Verify tenant_id is NULL
    if (userProfile.tenant_id !== null) {
      console.warn('⚠️  WARNING: tenant_id is not NULL! Updating to NULL...');
      const { error: fixError } = await supabase
        .from('users')
        .update({ tenant_id: null })
        .eq('id', authUserId);

      if (fixError) {
        console.error('❌ Error fixing tenant_id:', fixError);
        // Continue anyway - the user is created
      } else {
        // Refresh userProfile
        const { data: updatedProfile } = await supabase
          .from('users')
          .select('id, email, full_name, role, tenant_id, is_active')
          .eq('id', authUserId)
          .single();
        
        if (updatedProfile) {
          Object.assign(userProfile, updatedProfile);
        }
      }
    }

    console.log('✅ Solution Owner created successfully:', {
      id: userProfile.id,
      email: userProfile.email,
      role: userProfile.role,
      tenant_id: userProfile.tenant_id
    });

    res.json({
      success: true,
      message: 'Solution Owner created successfully',
      user: {
        id: userProfile.id,
        email: userProfile.email,
        full_name: userProfile.full_name,
        role: userProfile.role,
        tenant_id: userProfile.tenant_id,
        is_active: userProfile.is_active
      }
    });
  } catch (error: any) {
    console.error('Create Solution Owner error:', error);
    res.status(500).json({ 
      error: error.message || 'Internal server error' 
    });
  }
});

export { router as authRoutes };

