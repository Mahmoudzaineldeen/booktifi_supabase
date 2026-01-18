/*
  # Allow Authenticated Users to Create Their Profile

  1. Changes
    - Add policy to allow newly registered users to create their own user profile
    - This enables the signup flow to work in production without backend server

  2. Security
    - Only allows authenticated users to create their own profile (matching auth.uid())
    - Users can only create profiles for their own authenticated user ID
*/

-- Drop existing policy if it exists
DROP POLICY IF EXISTS "Authenticated users can create their profile" ON users;

-- Allow authenticated users to insert their own user profile
CREATE POLICY "Authenticated users can create their profile"
  ON users FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());