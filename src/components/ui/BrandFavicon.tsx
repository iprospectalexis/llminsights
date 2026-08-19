import React, { useState } from 'react';

// Favicon of a brand's official site via Google's free s2 service, with a
// letter-circle fallback when the domain is unknown or the image fails.
export function BrandFavicon({
  name,
  domain,
  size = 16,
  rounded = 'rounded',
}: {
  name: string;
  domain?: string | null;
  size?: number;
  rounded?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!domain || failed) {
    return (
      <span
        className={`inline-flex items-center justify-center ${rounded} bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 font-semibold flex-shrink-0 select-none`}
        style={{ width: size, height: size, fontSize: Math.max(8, size * 0.55) }}
        title={name}
      >
        {(name || '?').charAt(0).toUpperCase()}
      </span>
    );
  }

  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
      alt={`${name} logo`}
      title={domain}
      className={`${rounded} flex-shrink-0 object-contain`}
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
}
