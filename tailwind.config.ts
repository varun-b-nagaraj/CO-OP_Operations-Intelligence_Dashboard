import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{js,ts,jsx,tsx}', './lib/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          maroon: '#800000'
        }
      },
      transitionDuration: {
        150: '150ms',
        200: '200ms'
      }
    }
  },
  plugins: []
};

export default config;
