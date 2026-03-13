import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  icon,
  className = '',
  ...props
}) => {
  return (
    <div className="space-y-1">
      {label && (
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-100">
          {label}
        </label>
      )}
      <div className="relative">
        {icon && (
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <div className="text-gray-400 dark:text-gray-300">
              {icon}
            </div>
          </div>
        )}
        <input
          className={`
            block w-full rounded-2xl border border-gray-300 dark:border-gray-500 
            bg-white dark:bg-gray-800 px-4 py-2.5 text-gray-900 dark:text-white
            placeholder-gray-500 dark:placeholder-gray-300
            focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20
            transition-colors duration-200
            ${icon ? 'pl-10' : ''}
            ${error ? 'border-red-300 focus:border-red-500 focus:ring-red-500/20' : ''}
            ${className}
          `}
          {...props}
        />
      </div>
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
};