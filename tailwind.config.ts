import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))',
        },
        // Extended brand palette
        brand: {
          50: '#eef2ff', 100: '#e0e7ff', 200: '#c7d2fe', 300: '#a5b4fc',
          400: '#818cf8', 500: '#6366f1', 600: '#4f46e5', 700: '#4338ca',
          800: '#3730a3', 900: '#312e81', 950: '#1e1b4b',
        },
      },
      borderRadius: {
        sm: '8px', DEFAULT: '12px', md: '12px',
        lg: '16px', xl: '20px', '2xl': '24px', '3xl': '32px',
        full: '9999px',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'Fira Code', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.65rem', { lineHeight: '1rem' }],
        xs:   ['0.75rem', { lineHeight: '1.125rem' }],
        sm:   ['0.875rem', { lineHeight: '1.375rem' }],
        base: ['1rem',    { lineHeight: '1.625rem' }],
        lg:   ['1.125rem',{ lineHeight: '1.75rem'  }],
        xl:   ['1.25rem', { lineHeight: '1.875rem' }],
        '2xl':['1.5rem',  { lineHeight: '2rem'     }],
        '3xl':['1.875rem',{ lineHeight: '2.25rem'  }],
        '4xl':['2.25rem', { lineHeight: '2.5rem'   }],
        '5xl':['3rem',    { lineHeight: '1.1'      }],
        '6xl':['3.75rem', { lineHeight: '1.05'     }],
        '7xl':['4.5rem',  { lineHeight: '1'        }],
        '8xl':['6rem',    { lineHeight: '1'        }],
      },
      letterSpacing: {
        tightest: '-0.04em', tighter: '-0.03em', tight: '-0.02em',
        snug: '-0.01em', normal: '0', wide: '0.025em',
        wider: '0.05em', widest: '0.1em',
      },
      spacing: {
        '18': '4.5rem', '22': '5.5rem', '26': '6.5rem',
        '30': '7.5rem', '34': '8.5rem', '88': '22rem',
        '112': '28rem', '128': '32rem',
      },
      boxShadow: {
        'sm':  'var(--shadow-sm)',
        DEFAULT: 'var(--shadow)',
        'md':  'var(--shadow-md)',
        'lg':  'var(--shadow-lg)',
        'xl':  'var(--shadow-xl)',
        'inner-sm': 'inset 0 1px 2px rgba(0,0,0,0.06)',
        'primary': '0 4px 14px 0 hsl(var(--primary) / 0.25)',
        'primary-lg': '0 8px 30px hsl(var(--primary) / 0.35)',
        'glow': '0 0 0 3px hsl(var(--primary) / 0.15)',
      },
      backgroundImage: {
        'gradient-brand': 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #06b6d4 100%)',
        'gradient-brand-v': 'linear-gradient(180deg, #6366f1 0%, #8b5cf6 100%)',
        'gradient-dark': 'linear-gradient(180deg, hsl(0 0% 6%) 0%, hsl(240 4% 9%) 100%)',
        'gradient-subtle': 'linear-gradient(135deg, hsl(var(--primary)/0.05) 0%, transparent 60%)',
        'gradient-radial-brand': 'radial-gradient(ellipse at top, hsl(var(--primary)/0.15), transparent 70%)',
        'grid-light': "linear-gradient(hsl(var(--border)/0.6) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--border)/0.6) 1px, transparent 1px)",
      },
      backgroundSize: {
        'grid': '40px 40px',
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'fade-up': 'fade-up 0.4s ease-out',
        'fade-in': 'fade-in 0.3s ease-out',
        'scale-in': 'scale-in 0.25s ease-out',
        'slide-right': 'slide-right 0.3s ease-out',
        'shimmer': 'shimmer 1.5s infinite',
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        'spin-slow': 'spin 3s linear infinite',
      },
      transitionTimingFunction: {
        'apple': 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        'spring': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        'smooth': 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}

export default config
