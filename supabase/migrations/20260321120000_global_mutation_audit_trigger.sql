BEGIN;

CREATE OR REPLACE FUNCTION public.audit_resolve_actor(
  new_row JSONB,
  old_row JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  actor TEXT;
BEGIN
  actor := COALESCE(
    NULLIF(new_row ->> 'updated_by', ''),
    NULLIF(new_row ->> 'created_by', ''),
    NULLIF(new_row ->> 'reviewed_by', ''),
    NULLIF(new_row ->> 'marked_by', ''),
    NULLIF(new_row ->> 'actor', ''),
    NULLIF(new_row ->> 'user_id', ''),
    NULLIF(new_row ->> 'employee_s_number', ''),
    NULLIF(new_row ->> 'employee_id', ''),
    NULLIF(old_row ->> 'updated_by', ''),
    NULLIF(old_row ->> 'created_by', ''),
    NULLIF(old_row ->> 'reviewed_by', ''),
    NULLIF(old_row ->> 'marked_by', ''),
    NULLIF(old_row ->> 'actor', ''),
    NULLIF(old_row ->> 'user_id', ''),
    NULLIF(old_row ->> 'employee_s_number', ''),
    NULLIF(old_row ->> 'employee_id', ''),
    NULLIF(current_setting('request.jwt.claim.sub', true), ''),
    NULLIF((auth.uid())::TEXT, ''),
    'open_access'
  );

  RETURN actor;
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_resolve_record_id(
  source_table TEXT,
  new_row JSONB,
  old_row JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  record_id TEXT;
BEGIN
  record_id := COALESCE(
    NULLIF(new_row ->> 'id', ''),
    NULLIF(new_row ->> 'record_id', ''),
    NULLIF(new_row ->> 'item_id', ''),
    NULLIF(new_row ->> 'row_id', ''),
    NULLIF(new_row ->> 'session_id', ''),
    NULLIF(new_row ->> 'calendar_event_id', ''),
    NULLIF(new_row ->> 'inventory_check_id', ''),
    NULLIF(new_row ->> 'employee_id', ''),
    NULLIF(new_row ->> 'employee_s_number', ''),
    NULLIF(old_row ->> 'id', ''),
    NULLIF(old_row ->> 'record_id', ''),
    NULLIF(old_row ->> 'item_id', ''),
    NULLIF(old_row ->> 'row_id', ''),
    NULLIF(old_row ->> 'session_id', ''),
    NULLIF(old_row ->> 'calendar_event_id', ''),
    NULLIF(old_row ->> 'inventory_check_id', ''),
    NULLIF(old_row ->> 'employee_id', ''),
    NULLIF(old_row ->> 'employee_s_number', ''),
    source_table || ':' || COALESCE(NULLIF(new_row::TEXT, ''), NULLIF(old_row::TEXT, ''), 'unknown')
  );

  RETURN LEFT(record_id, 512);
END;
$$;

CREATE OR REPLACE FUNCTION public.capture_mutation_to_audit_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_payload JSONB;
  new_payload JSONB;
  actor TEXT;
  resolved_record_id TEXT;
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME IN ('audit_log', 'hr_audit_log', 'product_audit_log', 'inventory_check_audit_log') THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  old_payload := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN TO_JSONB(OLD) ELSE NULL END;
  new_payload := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN TO_JSONB(NEW) ELSE NULL END;

  actor := public.audit_resolve_actor(new_payload, old_payload);
  resolved_record_id := public.audit_resolve_record_id(TG_TABLE_NAME, new_payload, old_payload);

  INSERT INTO public.audit_log (user_id, action, table_name, record_id, old_value, new_value, timestamp)
  VALUES (actor, LOWER(TG_OP), TG_TABLE_NAME, resolved_record_id, old_payload, new_payload, NOW());

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Never block production writes because of audit insert failures.
    RAISE WARNING 'capture_mutation_to_audit_log failed for %.%: %',
      TG_TABLE_SCHEMA, TG_TABLE_NAME, SQLERRM;
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

DO $$
DECLARE
  relation RECORD;
BEGIN
  FOR relation IN
    SELECT
      c.relname AS table_name,
      format('%I.%I', n.nspname, c.relname) AS qualified_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname NOT IN ('audit_log', 'hr_audit_log', 'product_audit_log', 'inventory_check_audit_log')
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_capture_mutation_to_audit_log ON %s',
      relation.qualified_name
    );
    EXECUTE format(
      'CREATE TRIGGER trg_capture_mutation_to_audit_log AFTER INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION public.capture_mutation_to_audit_log()',
      relation.qualified_name
    );
  END LOOP;
END;
$$;

COMMIT;
