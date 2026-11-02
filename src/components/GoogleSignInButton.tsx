import React, { useState } from 'react';

export interface GoogleSignInButtonProps {
  onClick: () => void | Promise<void>;
  label?: string;
  disabled?: boolean;
  className?: string;
}

export const GoogleSignInButton: React.FC<GoogleSignInButtonProps> = ({
  onClick,
  label = 'Sign in with Google',
  disabled = false,
  className = '',
}) => {
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    if (disabled || busy) return;
    setBusy(true);
    try {
      await onClick();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || busy}
      className={`inline-flex min-h-[42px] items-center justify-center gap-2.5 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 shadow-2xs transition-colors hover:bg-slate-50 active:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap shrink-0 ${className}`}
    >
      <svg
        className="h-4 w-4 shrink-0"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          fill="#4285F4"
          d="M23.49 12.275c0-.85-.075-1.675-.215-2.475H12v4.69h6.45c-.28 1.5-1.125 2.775-2.395 3.63v3.015h3.875c2.265-2.085 3.56-5.16 3.56-8.86z"
        />
        <path
          fill="#34A853"
          d="M12 24c3.24 0 5.955-1.075 7.94-2.91l-3.875-3.015c-1.075.72-2.45 1.15-4.065 1.15-3.125 0-5.77-2.11-6.715-4.945H1.28v3.11C3.255 21.31 7.31 24 12 24z"
        />
        <path
          fill="#FBBC05"
          d="M5.285 14.28A7.215 7.215 0 0 1 4.91 12c0-.795.135-1.565.375-2.28V6.61H1.28A11.995 11.995 0 0 0 0 12c0 1.935.465 3.765 1.28 5.39l4.005-3.11z"
        />
        <path
          fill="#EA4335"
          d="M12 4.775c1.76 0 3.34.605 4.585 1.795l3.435-3.435C17.95 1.19 15.235 0 12 0 7.31 0 3.255 2.69 1.28 6.61l4.005 3.11c.945-2.835 3.59-4.945 6.715-4.945z"
        />
      </svg>
      <span>{busy ? 'Menghubungkan...' : label}</span>
    </button>
  );
};
