import typography from '@tailwindcss/typography';

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx,vue}",
  ],
  theme: {
    extend: {
      maxWidth: {
        '7xl': 'clamp(80rem, 92vw, 112rem)',
      },
      colors: {
        // CredMate Brand Colors
        brand: {
          purple: {
            DEFAULT: '#6298FC',
            dark: '#507EDB',
            light: '#5a2870',
          },
          magenta: {
            DEFAULT: '#9e2a5b',
            dark: '#8e2451',
            light: '#ae3065',
          },
        },
        // Status Colors
        status: {
          success: '#10b981', // Green - Approved/Active
          danger: '#ef4444',  // Red - Rejected/Overdue
          warning: '#f59e0b', // Amber - Pending
          info: '#3b82f6',    // Blue - Info
        },
        // UI Colors
        surface: {
          dark: '#1a1a2e',
          DEFAULT: '#16213e',
          light: '#1f2937',
        },
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, #6298FC 0%, #507EDB 100%)',
        'brand-gradient-hover': 'linear-gradient(135deg, #4a6bd3 0%, #4160bd 100%)',
        'brand-gradient-vertical': 'linear-gradient(180deg, #4a1e60 0%, #9e2a5b 100%)',
      },
      fontFamily: {
        sans: ['Cabin', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'brand': '0 4px 14px 0 rgba(74, 30, 96, 0.39)',
        'card': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        'card-hover': '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [typography],
}
