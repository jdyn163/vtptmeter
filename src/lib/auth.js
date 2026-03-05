import { supabase } from './supabase'

// Looks up a 4-digit PIN in the users table.
// Returns { id, display_name, role } on success, or null if not found.
export async function loginWithPin(pin) {
  const { data, error } = await supabase
    .from('users')
    .select('id, display_name, role')
    .eq('pin', pin)
    .single()

  if (error || !data) return null
  return data
}
