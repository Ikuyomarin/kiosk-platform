import { createClient } from '@supabase/supabase-js'

// .env.local 파일에서 아까 저장한 URL과 키를 자동으로 읽어옵니다.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Supabase 클라이언트를 생성하고 내보냅니다.
export const supabase = createClient(supabaseUrl, supabaseKey)