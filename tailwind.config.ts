import type { Config } from 'tailwindcss';

/**
 * Token-mapped Tailwind theme.
 *
 * The existing app leans heavily on hardcoded utilities (`bg-white`,
 * `border-neutral-300`, `bg-neutral-100`, `text-neutral-700`, ...). Rather than
 * touch hundreds of JSX files, we re-point those exact color tokens at CSS
 * variables defined in globals.css. Result: every existing surface gains the
 * refined light palette AND automatic dark-mode support, with no markup edits.
 */
const config: Config = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./app/**/*.{js,ts,jsx,tsx}', './lib/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          maroon: 'var(--brand)',
          600: 'var(--brand-600)',
          700: 'var(--brand-700)',
          tint: 'var(--brand-tint)'
        },
        // `bg-white` now resolves to the themed surface (white in light mode,
        // dark card in dark mode). This is the app's primary card surface.
        white: 'var(--surface)',
        // Neutral ramp remapped to themed tokens. Existing classes such as
        // `bg-neutral-100`, `border-neutral-300`, `text-neutral-700` keep
        // working but now follow the active theme automatically.
        neutral: {
          50: 'var(--surface-2)',
          100: 'var(--surface-sunken)',
          200: 'var(--border)',
          300: 'var(--border-strong)',
          400: 'var(--text-muted)',
          500: 'var(--text-muted)',
          600: 'var(--text-soft)',
          700: 'var(--text-soft)',
          800: 'var(--text)',
          900: 'var(--text)'
        },
        surface: {
          DEFAULT: 'var(--surface)',
          2: 'var(--surface-2)',
          sunken: 'var(--surface-sunken)'
        },
        ink: {
          DEFAULT: 'var(--text)',
          soft: 'var(--text-soft)',
          muted: 'var(--text-muted)'
        },
        line: {
          DEFAULT: 'var(--border)',
          strong: 'var(--border-strong)'
        },
        viz: {
          amber: 'var(--accent-amber)',
          teal: 'var(--accent-teal)',
          blue: 'var(--accent-blue)',
          green: 'var(--accent-green)',
          rose: 'var(--accent-rose)'
        }
      },
      fontFamily: {
        display: 'var(--font-display)',
        sans: 'var(--font-body)',
        mono: 'var(--font-mono)'
      },
      borderRadius: {
        none: '0',
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius)',
        md: 'var(--radius)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)'
      },
      boxShadow: {
        xs: 'var(--shadow-xs)',
        sm: 'var(--shadow-sm)',
        DEFAULT: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        ring: 'var(--ring)'
      },
      transitionDuration: {
        150: '150ms',
        200: '200ms'
      },
      transitionTimingFunction: {
        smooth: 'cubic-bezier(0.22, 1, 0.36, 1)'
      }
    }
  },
  plugins: []
};

export default config;
