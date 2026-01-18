import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { db } from '../../lib/db';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { LanguageToggle } from '../../components/layout/LanguageToggle';
import { PhoneInput } from '../../components/ui/PhoneInput';
import { Calendar } from 'lucide-react';

export function SignupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [businessNameAr, setBusinessNameAr] = useState('');
  const [industry, setIndustry] = useState('restaurant');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Validate required fields
      if (!businessName || businessName.trim() === '') {
        setError('Business name (English) is required');
        setLoading(false);
        return;
      }

      if (!businessNameAr || businessNameAr.trim() === '') {
        setError('Business name (Arabic) is required');
        setLoading(false);
        return;
      }

      if (!fullName || fullName.trim() === '') {
        setError('Full name is required');
        setLoading(false);
        return;
      }

      if (!email || email.trim() === '') {
        setError('Email address is required');
        setLoading(false);
        return;
      }

      if (!phone || phone.trim() === '' || phone === '+966') {
        setError('Phone number is required');
        setLoading(false);
        return;
      }

      if (!password || password.length < 6) {
        setError('Password must be at least 6 characters');
        setLoading(false);
        return;
      }

      // Log form data for debugging
      console.log('Form submission data:', {
        businessName,
        businessNameAr,
        industry,
        fullName,
        email,
        phone,
        passwordLength: password.length
      });

      // CRITICAL: Ensure we're not authenticated before creating tenant
      // This ensures we use the anon role, not authenticated role
      const { data: { session } } = await db.auth.getSession();
      if (session) {
        console.log('Found existing session, signing out first');
        await db.auth.signOut();
      }

      // Step 1: Create the tenant FIRST (using anonymous access)
      const subscriptionEnd = new Date();
      subscriptionEnd.setDate(subscriptionEnd.getDate() + 30);

      // Generate a slug from the business name
      // Match database trigger: lower(regexp_replace(name, '[^a-zA-Z0-9]+', '', 'g'))
      // This removes all non-alphanumeric characters (no dashes)
      let baseSlug = businessName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '') // Remove all non-alphanumeric (no dashes)
        .substring(0, 50);

      // Ensure slug is not empty
      if (!baseSlug || baseSlug.trim() === '') {
        setError('Business name must contain at least one letter or number');
        setLoading(false);
        return;
      }

      // Check if slug exists and generate unique one if needed
      let slug = baseSlug;
      let slugCounter = 1;
      let slugExists = true;
      
      while (slugExists && slugCounter < 100) {
        const { data: existingTenant } = await db
          .from('tenants')
          .select('id')
          .eq('slug', slug)
          .maybeSingle();
        
        if (!existingTenant) {
          slugExists = false;
        } else {
          // Slug exists, try with number suffix
          slug = `${baseSlug}-${slugCounter}`;
          slugCounter++;
        }
      }

      if (slugExists) {
        setError('Unable to generate unique business URL. Please try a different business name.');
        setLoading(false);
        return;
      }

      console.log('Creating tenant with data:', {
        name: businessName.trim(),
        name_ar: (businessNameAr || businessName).trim(),
        slug,
        industry,
        contact_email: email.trim(),
        contact_phone: phone.trim(),
      });

      const { data: tenant, error: tenantError } = await db
        .from('tenants')
        .insert({
          name: businessName.trim(),
          name_ar: (businessNameAr || businessName).trim(),
          slug,
          industry,
          tenant_time_zone: 'Asia/Riyadh',
          announced_time_zone: 'Asia/Riyadh',
          contact_email: email.trim(),
          contact_phone: phone.trim(),
          subscription_end: subscriptionEnd.toISOString(),
          is_active: true,
          public_page_enabled: true,
        })
        .select()
        .single();

      if (tenantError) {
        console.error('Tenant creation error:', tenantError);
        console.error('Full error details:', JSON.stringify(tenantError, null, 2));
        console.error('Error keys:', Object.keys(tenantError));
        console.error('Error message:', tenantError.message);
        console.error('Error hint:', tenantError.hint);
        console.error('Error details:', tenantError.details);
        console.error('Error code:', tenantError.code);

        // Handle duplicate slug error specifically
        if (tenantError.message?.includes('slug') || tenantError.message?.includes('duplicate')) {
          setError('This business name is already taken. Please choose a different business name.');
        } else if (tenantError.code === '23505') {
          setError('This business name or URL is already taken. Please choose a different business name.');
        } else {
          // Try to get any error message we can
          const errorMsg = tenantError.message || tenantError.hint || tenantError.details || (typeof tenantError === 'string' ? tenantError : JSON.stringify(tenantError));
          setError(`Failed to set up business: ${errorMsg}`);
        }
        setLoading(false);
        return;
      }

      if (!tenant || !tenant.id) {
        setError('Failed to create tenant. Please try again.');
        setLoading(false);
        return;
      }

      console.log('Tenant created successfully:', tenant);

      // Step 2: Create auth user with tenant_id already set
      // The backend signup endpoint creates the user in the users table, so we don't need a separate insert
      console.log('Creating user account with data:', {
        email: email.trim(),
        full_name: fullName.trim(),
        role: 'tenant_admin',
        tenant_id: tenant.id,
        phone: phone.trim(),
      });

      const { data: authData, error: authError } = await db.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: window.location.origin,
          data: {
            full_name: fullName.trim(),
            role: 'tenant_admin',
            tenant_id: tenant.id,
            phone: phone.trim(), // Include phone in signup
          },
        },
      });

      if (authError) {
        console.error('Auth creation error:', authError);
        // If auth creation fails, delete the tenant
        try {
        await db.from('tenants').delete().eq('id', tenant.id);
        } catch (deleteError) {
          console.error('Failed to delete tenant after auth error:', deleteError);
        }
        setError(authError.message || 'Failed to create account. Please try again.');
        setLoading(false);
        return;
      }

      // Step 3: User profile is already created by the backend signup endpoint
      // If we need to update additional fields, we can do it here
      if (authData?.user) {
        // User is already created with all fields, no need for separate insert
        console.log('User created successfully:', authData.user);
      } else {
        console.warn('User creation response missing user data');
      }

      setSuccess(true);
      setLoading(false);
      
      // Show success message for 2 seconds before redirecting
      setTimeout(() => {
        navigate('/login');
      }, 2000);
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Calendar className="w-10 h-10 text-blue-600" />
            <span className="text-3xl font-bold text-gray-900">Bookati</span>
          </div>
          <div className="flex justify-center">
            <LanguageToggle />
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-center">Start Your Free Trial</CardTitle>
            <p className="text-sm text-gray-600 text-center mt-2">
              Sign up to create your booking management system
            </p>
          </CardHeader>
          <CardContent>
            {success ? (
              <div className="space-y-4">
              <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-center">
                  <p className="font-medium text-lg">✅ Account created successfully!</p>
                  <p className="text-sm mt-2">Your business has been set up and you can now start managing bookings.</p>
                  <p className="text-sm mt-1">Redirecting to login page...</p>
                </div>
                <div className="text-center">
                  <Button
                    onClick={() => navigate('/login')}
                    fullWidth
                  >
                    Go to Login
                  </Button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                    {error}
                  </div>
                )}

                <Input
                  type="text"
                  label="Business Name (English)"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  required
                  placeholder="e.g., Premium Salon"
                />

                <Input
                  type="text"
                  label="Business Name (Arabic)"
                  value={businessNameAr}
                  onChange={(e) => setBusinessNameAr(e.target.value)}
                  required
                  dir="rtl"
                  placeholder="مثال: صالون بريميوم"
                />

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Industry <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required
                  >
                    <option value="restaurant">Restaurant</option>
                    <option value="salon">Salon & Beauty</option>
                    <option value="clinic">Medical Clinic</option>
                    <option value="parking">Parking</option>
                    <option value="venue">Event Venue</option>
                    <option value="touristic_venue">Touristic Venue</option>
                    <option value="work_space">Work Space</option>
                    <option value="technical_services">Technical Services</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <Input
                  type="text"
                  label="Your Full Name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  placeholder="John Doe"
                />

                <Input
                  type="email"
                  label="Email Address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="your@email.com"
                />

                <PhoneInput
                  label="Phone Number"
                  value={phone}
                  onChange={(value) => setPhone(value)}
                  defaultCountry="+966"
                  required
                />

                <Input
                  type="password"
                  label="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  helperText="Minimum 6 characters"
                />

                <Button type="submit" fullWidth loading={loading}>
                  Start Free Trial
                </Button>

                <div className="text-center text-sm text-gray-600">
                  Already have an account?{' '}
                  <button
                    type="button"
                    onClick={() => navigate('/login')}
                    className="text-blue-600 hover:text-blue-700 font-medium"
                  >
                    Sign In
                  </button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
