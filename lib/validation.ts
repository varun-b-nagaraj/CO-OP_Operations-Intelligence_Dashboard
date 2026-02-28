import { z } from 'zod';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const isValidDateString = (value: string): boolean => {
  if (!DATE_REGEX.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

export const DateStringSchema = z
  .string()
  .regex(DATE_REGEX, 'Date must use YYYY-MM-DD format')
  .refine(isValidDateString, 'Date must be a valid calendar date');

export const SNumberSchema = z.string().trim().min(1).max(50);
export const EmployeeIdSchema = z.string().trim().regex(/^\d+$/, 'employee_id must be a numeric student id');

export const ShiftSlotKeySchema = z.string().trim().min(1).max(200);

export const StrikeSchema = z.object({
  employee_id: EmployeeIdSchema,
  reason: z.string().trim().min(1).max(500)
});

export const AttendanceOverrideSchema = z
  .object({
    s_number: SNumberSchema,
    checkin_date: DateStringSchema,
    scope: z.enum(['meeting', 'shift']),
    shift_period: z.number().int().min(0).max(8).nullable(),
    override_type: z.enum(['excused', 'present_override']),
    reason: z.string().trim().min(1).max(500)
  })
  .superRefine((value, ctx) => {
    if (value.scope === 'meeting' && value.shift_period !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['shift_period'],
        message: "shift_period must be null when scope='meeting'"
      });
    }

    if (value.scope === 'shift' && value.shift_period === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['shift_period'],
        message: "shift_period is required when scope='shift'"
      });
    }
  });

export const ShiftExchangeRequestSchema = z
  .object({
    shift_date: DateStringSchema,
    shift_period: z.number().int().min(0).max(8),
    shift_slot_key: ShiftSlotKeySchema,
    from_employee_s_number: SNumberSchema,
    to_employee_s_number: SNumberSchema,
    reason: z.string().trim().min(1).max(500)
  })
  .superRefine((value, ctx) => {
    if (value.from_employee_s_number === value.to_employee_s_number) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to_employee_s_number'],
        message: 'To employee must be different from from employee'
      });
    }
  });

export const ShiftExchangeReviewSchema = z.object({
  request_id: z.string().uuid()
});

export const PointsEntrySchema = z.object({
  employee_id: EmployeeIdSchema,
  point_type: z.enum(['meeting', 'morning_shift', 'off_period_shift', 'project', 'manual']),
  points: z.number().int(),
  description: z.string().trim().max(500).nullable().optional()
});

export const EmployeeSettingsSchema = z.object({
  employee_id: EmployeeIdSchema,
  employee_s_number: SNumberSchema,
  off_periods: z.array(z.number().int().min(1).max(8)).max(8)
});

export const EmployeeLoginCredentialsSchema = z.object({
  employee_id: EmployeeIdSchema,
  username: z.string().trim().min(3).max(120),
  password: z.string().min(8).max(256)
});

export const CFAItemIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9_]+$/, 'item_id must be lowercase alphanumeric or underscore only');

export const CFAItemCreateSchema = z.object({
  item_id: CFAItemIdSchema,
  name: z.string().trim().min(1).max(200),
  buy_cost_cents: z.number().int().min(0),
  sell_price_cents: z.number().int().min(0),
  active: z.boolean().optional()
});

export const CFAItemUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  buy_cost_cents: z.number().int().min(0),
  sell_price_cents: z.number().int().min(0),
  active: z.boolean()
});

export const CFADailyLogLineInputSchema = z
  .object({
    item_id: CFAItemIdSchema,
    received_qty: z.number().int().min(0),
    leftover_qty: z.number().int().min(0),
    missed_demand_qty: z.number().int().min(0)
  })
  .superRefine((value, ctx) => {
    if (value.leftover_qty > value.received_qty) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['leftover_qty'],
        message: 'leftover_qty cannot be greater than received_qty'
      });
    }
  });

export const CFADailyLogUpsertSchema = z.object({
  log_date: DateStringSchema,
  day_type: z.enum(['A', 'B']),
  lines: z.array(CFADailyLogLineInputSchema).min(1)
});

export const ShiftAttendanceSchema = z.object({
  shift_date: DateStringSchema,
  shift_period: z.number().int().min(0).max(8),
  shift_slot_key: ShiftSlotKeySchema,
  employee_s_number: SNumberSchema,
  status: z.enum(['expected', 'present', 'absent', 'excused']),
  source: z.enum(['scheduler', 'manual', 'shift_exchange', 'rebuild']),
  reason: z.string().trim().max(500).nullable().optional()
});

export const ShiftAttendanceMarkSchema = z.object({
  s_number: SNumberSchema,
  date: DateStringSchema,
  period: z.number().int().min(0).max(8),
  shift_slot_key: ShiftSlotKeySchema,
  reason: z.string().trim().max(500).optional()
});

export const ScheduleParamsSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  anchorDate: DateStringSchema,
  anchorDay: z.enum(['A', 'B']),
  seed: z.number().int(),
  forceRefresh: z.boolean().optional(),
  forceRebuildExpectedShifts: z.boolean().optional()
});

export const MeetingAttendanceParamsSchema = z
  .object({
    date: DateStringSchema.optional(),
    from: DateStringSchema.optional(),
    to: DateStringSchema.optional(),
    exclude: z.string().max(500).optional()
  })
  .superRefine((value, ctx) => {
    if (value.date && (value.from || value.to)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['date'],
        message: 'Use either date or from/to, not both'
      });
    }
  });

const OptionalDateOrEmptySchema = z.union([DateStringSchema, z.literal('')]).optional();

const RawScheduleMetaSchema = z.object({
  year: z.number().int(),
  month: z.number().int(),
  anchorDate: DateStringSchema,
  anchorDay: z.enum(['A', 'B']),
  seed: z.number().int(),
  generatedAt: z.string(),
  regularsPerShift: z.number(),
  alternatesPerShift: z.number()
});

export const ScheduleApiResponseSchema = z.object({
  meta: RawScheduleMetaSchema,
  roster: z.array(
    z.object({
      id: z.union([z.number(), z.string()]),
      name: z.string(),
      s_number: SNumberSchema,
      scheduleable: z.boolean(),
      Schedule: z.number().optional()
    })
  ),
  calendar: z.record(z.enum(['A', 'B'])),
  schedule: z.array(
    z.object({
      Date: DateStringSchema,
      Day: z.string(),
      Period: z.number().int().min(0).max(8),
      Student: z.string(),
      Type: z.string(),
      Group: z.string(),
      Role: z.string()
    })
  ),
  summary: z.array(
    z.object({
      Student: z.string(),
      Role: z.string(),
      Group: z.string(),
      'Regular Shifts': z.number(),
      'Alternate Shifts': z.number(),
      'Total Shifts': z.number(),
      'Periods Worked': z.string()
    })
  ),
  statistics: z.array(
    z.object({
      Metric: z.string(),
      Value: z.union([z.number(), z.string()])
    })
  ),
  balanceAnalysis: z.array(
    z.object({
      Category: z.string(),
      Metric: z.string(),
      Value: z.union([z.number(), z.string()])
    })
  )
});

export const MeetingAttendanceApiResponseSchema = z.object({
  ok: z.boolean(),
  dates: z.array(DateStringSchema),
  meta: z.object({
    timezone: z.string(),
    generated_at: z.string(),
    filters: z.object({
      date: OptionalDateOrEmptySchema,
      from: OptionalDateOrEmptySchema,
      to: OptionalDateOrEmptySchema,
      exclude: z.union([z.string(), z.array(z.string())]).optional()
    })
  }),
  analytics: z.object({
    total_students: z.number().int().nonnegative(),
    total_sessions: z.number().int().nonnegative(),
    avg_attendance: z.number(),
    students: z.array(
      z.object({
        name: z.string(),
        s_number: SNumberSchema,
        present_count: z.number().int().nonnegative(),
        absent_count: z.number().int().nonnegative(),
        attendance_rate: z.number()
      })
    )
  }),
  sessions: z.array(
    z.object({
      date: DateStringSchema,
      present_count: z.number().int().nonnegative(),
      absent_count: z.number().int().nonnegative(),
      total_students: z.number().int().nonnegative(),
      attendance_rate: z.number()
    })
  ),
  roster: z.array(
    z.object({
      name: z.string(),
      s_number: SNumberSchema
    })
  )
});

export function sanitizeTextInput(input: string): string {
  return input.trim().replace(/\s+/g, ' ');
}

export function zodFieldErrors(error: z.ZodError): Record<string, string> {
  return error.issues.reduce<Record<string, string>>((accumulator, issue) => {
    const key = issue.path.join('.') || 'root';
    accumulator[key] = issue.message;
    return accumulator;
  }, {});
}
