import { createClient, SupabaseClient } from '@supabase/supabase-js';

let browserClient: SupabaseClient | null = null;
type BackendDepartment = 'hr' | 'marketing' | 'product' | 'inventory' | 'shared';

const HR_TABLES = new Set([
  'students',
  'hr_employee_settings',
  'hr_shift_attendance',
  'hr_morning_shift_attendance',
  'hr_off_period_shift_attendance',
  'hr_attendance_overrides',
  'hr_shift_change_requests',
  'hr_employee_login_credentials',
  'hr_schedules',
  'hr_strikes',
  'hr_points_ledger',
  'hr_meeting_attendance_records',
  'hr_audit_log',
  'hr_user_roles'
]);

const MARKETING_TABLES = new Set([
  'marketing_events',
  'marketing_event_categories',
  'marketing_reports',
  'external_contacts',
  'internal_coordinators',
  'event_assets',
  'event_contacts',
  'event_notes',
  'coordination_logs'
]);

function getTableFromRestPath(pathname: string): string | null {
  if (!pathname.startsWith('/rest/v1/')) return null;
  const segments = pathname.split('/');
  const table = segments[3];
  return table ? decodeURIComponent(table) : null;
}

function inferDepartmentFromRequestPath(pathname: string): BackendDepartment {
  const table = getTableFromRestPath(pathname);
  if (table) {
    if (table.startsWith('product_')) return 'product';
    if (table.startsWith('inventory_')) return 'inventory';
    if (table.startsWith('marketing_')) return 'marketing';
    if (table.startsWith('hr_')) return 'hr';
    if (table.startsWith('cfa_')) return 'inventory';
    if (MARKETING_TABLES.has(table)) return 'marketing';
    if (HR_TABLES.has(table)) return 'hr';
  }

  if (pathname.startsWith('/storage/v1/')) {
    return 'shared';
  }

  return 'shared';
}

function requireServerEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function createBrowserClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl) {
    throw new Error('Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL');
  }
  if (!supabaseAnonKey) {
    throw new Error('Missing required environment variable: NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }

  if (!browserClient) {
    const supabaseOrigin = new URL(supabaseUrl).origin;
    browserClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        fetch: async (input, init) => {
          const inputUrl = input instanceof Request ? input.url : String(input);
          let parsedUrl: URL | null = null;
          try {
            parsedUrl = new URL(inputUrl);
          } catch {
            parsedUrl = null;
          }

          if (parsedUrl && parsedUrl.origin === supabaseOrigin) {
            const department = inferDepartmentFromRequestPath(parsedUrl.pathname);
            const proxiedUrl = `/api/backend/${department}/supabase${parsedUrl.pathname}${parsedUrl.search}`;
            if (input instanceof Request) {
              return fetch(new Request(proxiedUrl, input));
            }
            return fetch(proxiedUrl, init);
          }

          return fetch(input, init);
        }
      }
    });
  }
  return browserClient;
}

export function createServerClient(): SupabaseClient {
  const supabaseUrl = requireServerEnv(
    'NEXT_PUBLIC_SUPABASE_URL',
    process.env.NEXT_PUBLIC_SUPABASE_URL
  );
  const serviceRoleKey = requireServerEnv(
    'SUPABASE_SERVICE_ROLE_KEY',
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  return createClient(
    supabaseUrl,
    serviceRoleKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    }
  );
}
