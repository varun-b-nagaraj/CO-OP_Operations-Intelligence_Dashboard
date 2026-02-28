# Operations Dashboard (Next.js App Router)

Production-ready operations dashboard implemented as a single-page route at `/hr` with primary module navigation (`HR`, `Chick-fil-A`) and tab navigation via query params.

## Stack

- Next.js (App Router) + TypeScript
- Tailwind CSS
- Supabase JS client
- React Query, React Hook Form, Zod, Lucide

## Local Setup

1. Install dependencies:
   - `npm install`
2. Copy environment file:
   - `cp .env.example .env.local`
3. Fill required vars in `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SCHEDULING_API_URL`
   - `MEETING_ATTENDANCE_API_URL`
4. Run dev server:
   - `npm run dev`
5. Open:
   - `http://localhost:3000/hr`

## Supabase Setup

1. Ensure existing `public.students` and `public.attendance` remain unchanged.
2. Apply migrations:
   - `supabase/migrations/20260228150000_hr_module.sql`
   - `supabase/migrations/20260228180000_employee_login_credentials.sql`
   - `supabase/migrations/20260228193000_cfa_module.sql`
3. Verify new HR tables exist with RLS enabled (`employee_login_credentials` is server-action only).

## Security Notes

- `SUPABASE_SERVICE_ROLE_KEY` is used only in server actions and route handlers.
- External APIs are called server-side only through:
  - `/api/schedule-proxy`
  - `/api/meeting-attendance-proxy`

## Delivered Modules

- `HR`
  - Tabs: `schedule` (default), `employees`, `meeting-attendance`, `shift-attendance`, `requests`, `audit`
- `Chick-fil-A`
  - Tabs: `daily-log` (default), `history`, `ab-analysis`, `forecast`, `menu`
