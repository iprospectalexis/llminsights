/*
  # Auto-create user profiles

  1. New Function
    - `handle_new_user()` function that creates a profile in public.users when a new auth user is created
  
  2. Trigger
    - Trigger on auth.users insert to automatically call the function
    
  3. Security
    - Function runs with security definer privileges to bypass RLS
*/

-- Create function to handle new user creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Insert new user into public.users table
  INSERT INTO public.users (id, email, full_name, role, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    CASE 
      WHEN NEW.email LIKE '%@iprospect.com' OR NEW.email LIKE '%@dentsu.com' THEN 'manager'
      ELSE 'client'
    END,
    NOW(),
    NOW()
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to automatically create user profile
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Also create profiles for existing auth users who don't have profiles yet
INSERT INTO public.users (id, email, full_name, role, created_at, updated_at)
SELECT 
  au.id,
  au.email,
  COALESCE(au.raw_user_meta_data->>'full_name', ''),
  CASE 
    WHEN au.email LIKE '%@iprospect.com' OR au.email LIKE '%@dentsu.com' THEN 'manager'
    ELSE 'client'
  END,
  au.created_at,
  NOW()
FROM auth.users au
LEFT JOIN public.users pu ON au.id = pu.id
WHERE pu.id IS NULL;