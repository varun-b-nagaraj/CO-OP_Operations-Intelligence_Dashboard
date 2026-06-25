'use client';

/**
 * Design-system primitives for the RRHS Co-Op dashboard.
 * Presentational only — no data/logic coupling. Pages opt in.
 */

import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import {
  CSSProperties,
  ElementType,
  HTMLAttributes,
  ReactNode,
  useEffect,
  useRef,
  useState
} from 'react';

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/* -------------------------------------------------------------------------- */
/* Reveal — entrance animation triggered when the element scrolls into view.  */
/* Respects prefers-reduced-motion via the CSS in globals.css.                */
/* -------------------------------------------------------------------------- */
export function Reveal({
  children,
  className,
  delay = 0,
  as: As = 'div'
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  as?: ElementType;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            io.disconnect();
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <As
      ref={ref as never}
      className={cx(className)}
      style={
        {
          opacity: shown ? undefined : 0,
          animation: shown
            ? `reveal-up 640ms cubic-bezier(0.22,1,0.36,1) ${delay}ms forwards`
            : undefined
        } as CSSProperties
      }
    >
      {children}
    </As>
  );
}

/* -------------------------------------------------------------------------- */
/* Card                                                                       */
/* -------------------------------------------------------------------------- */
export function Card({
  children,
  className,
  interactive = false,
  glass = false,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
  glass?: boolean;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx(
        glass ? 'surface-glass' : 'bg-surface border border-line',
        'rounded-lg shadow-sm',
        interactive &&
          'cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-maroon hover:shadow-md',
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Sparkline — tiny inline trend chart (pure SVG, no library).                */
/* -------------------------------------------------------------------------- */
export function Sparkline({
  data,
  width = 96,
  height = 30,
  stroke = 'var(--brand)',
  fill = true,
  className
}: {
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: boolean;
  className?: string;
}) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);
  const pad = 3;
  const usableH = height - pad * 2;
  const points = data.map((value, index) => {
    const x = index * stepX;
    const y = pad + usableH - ((value - min) / range) * usableH;
    return [x, y] as const;
  });
  const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  const gid = `spark-${Math.round(points[0][1]) + data.length}-${Math.round(max)}`;

  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      role="img"
      aria-hidden="true"
    >
      {fill && (
        <>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gid})`} />
        </>
      )}
      <path
        d={line}
        stroke={stroke}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={points[points.length - 1][0]} cy={points[points.length - 1][1]} r="2.4" fill={stroke} />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* StatCard — KPI tile with optional delta + sparkline                        */
/* -------------------------------------------------------------------------- */
type Trend = 'up' | 'down' | 'flat';

export function StatCard({
  label,
  value,
  delta,
  trend = 'flat',
  spark,
  icon,
  accent = 'var(--brand)',
  good = 'up',
  className
}: {
  label: string;
  value: ReactNode;
  delta?: string;
  trend?: Trend;
  spark?: number[];
  icon?: ReactNode;
  accent?: string;
  /** which trend direction is "good" — drives delta color */
  good?: 'up' | 'down';
  className?: string;
}) {
  const isGood = trend === 'flat' ? null : trend === good;
  const deltaColor =
    isGood === null ? 'text-ink-muted' : isGood ? 'text-viz-green' : 'text-viz-rose';
  const TrendIcon = trend === 'up' ? ArrowUpRight : trend === 'down' ? ArrowDownRight : Minus;

  return (
    <div
      className={cx(
        'group relative overflow-hidden rounded-lg border border-line bg-surface p-4 shadow-sm transition-all duration-200 hover:shadow-md',
        className
      )}
    >
      <span
        className="absolute inset-x-0 top-0 h-[3px] opacity-80"
        style={{ background: accent }}
        aria-hidden="true"
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium uppercase tracking-wide text-ink-muted">
            {label}
          </p>
          <p className="mt-1.5 font-display text-2xl font-bold leading-none text-ink">{value}</p>
        </div>
        {icon ? (
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-ink-soft"
            style={{ background: 'var(--surface-sunken)' }}
          >
            {icon}
          </span>
        ) : null}
      </div>
      <div className="mt-3 flex items-end justify-between gap-2">
        {delta ? (
          <span className={cx('inline-flex items-center gap-1 text-xs font-semibold', deltaColor)}>
            <TrendIcon className="h-3.5 w-3.5" />
            {delta}
          </span>
        ) : (
          <span />
        )}
        {spark && spark.length > 1 ? <Sparkline data={spark} stroke={accent} /> : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Button                                                                     */
/* -------------------------------------------------------------------------- */
export function Button({
  children,
  variant = 'primary',
  size = 'md',
  className,
  loading = false,
  disabled,
  ...rest
}: {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-md font-medium cursor-pointer transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed';
  const sizes = {
    sm: 'min-h-[36px] px-3 text-sm',
    md: 'min-h-[44px] px-4 text-sm',
    lg: 'min-h-[48px] px-6 text-base'
  };
  const variants = {
    primary:
      'bg-brand-maroon text-white shadow-sm hover:bg-brand-600 hover:shadow-md active:scale-[0.98]',
    secondary:
      'border border-line bg-surface text-ink-soft hover:border-brand-maroon hover:text-brand-maroon',
    ghost: 'text-ink-soft hover:bg-surface-sunken'
  };
  return (
    <button
      className={cx(base, sizes[size], variants[variant], className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : null}
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Badge                                                                      */
/* -------------------------------------------------------------------------- */
export function Badge({
  children,
  tone = 'neutral',
  className
}: {
  children: ReactNode;
  tone?: 'neutral' | 'brand' | 'green' | 'amber' | 'rose' | 'blue';
  className?: string;
}) {
  const tones = {
    neutral: 'bg-surface-sunken text-ink-soft border-line',
    brand: 'text-brand-maroon border-brand-maroon/30',
    green: 'text-viz-green border-current/30',
    amber: 'text-viz-amber border-current/30',
    rose: 'text-viz-rose border-current/30',
    blue: 'text-viz-blue border-current/30'
  };
  const bgStyle: Record<string, CSSProperties> = {
    brand: { background: 'var(--brand-tint)' }
  };
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        tones[tone],
        className
      )}
      style={bgStyle[tone]}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Skeleton                                                                   */
/* -------------------------------------------------------------------------- */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} />;
}

export { cx };
