import { createDepartmentSupabaseProxyHandlers } from '../../../_shared/supabase-proxy';

const handlers = createDepartmentSupabaseProxyHandlers('hr');

export const GET = handlers.GET;
export const POST = handlers.POST;
export const PUT = handlers.PUT;
export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
export const HEAD = handlers.HEAD;
export const OPTIONS = handlers.OPTIONS;
