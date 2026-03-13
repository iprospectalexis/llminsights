import { CSSProperties } from 'react';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const sizeMap = {
  sm: '16px',
  md: '24px',
  lg: '32px',
  xl: '48px',
};

export function LoadingSpinner({ size = 'md', className = '' }: LoadingSpinnerProps) {
  const style: CSSProperties = {
    width: sizeMap[size],
    height: sizeMap[size],
    display: 'inline-block',
  };

  return (
    <div className={`loading-spinner ${className}`} style={style}>
      <svg
        viewBox="-13 -13 45 45"
        xmlns="http://www.w3.org/2000/svg"
        style={{ width: '100%', height: '100%' }}
      >
        <defs>
          <linearGradient id="spinner-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f72585" />
            <stop offset="11%" stopColor="#b5179e" />
            <stop offset="22%" stopColor="#7209b7" />
            <stop offset="33%" stopColor="#560bad" />
            <stop offset="44%" stopColor="#480ca8" />
            <stop offset="55%" stopColor="#3a0ca3" />
            <stop offset="66%" stopColor="#3f37c9" />
            <stop offset="77%" stopColor="#4361ee" />
            <stop offset="88%" stopColor="#4895ef" />
            <stop offset="100%" stopColor="#4cc9f0" />
          </linearGradient>
        </defs>
        <style>
          {`
            .spinner-box {
              transform-origin: 50% 50%;
              fill: url(#spinner-gradient);
            }

            @keyframes moveBox-1 {
              9.0909090909% { transform: translate(-12px, 0); }
              18.1818181818% { transform: translate(0px, 0); }
              27.2727272727% { transform: translate(0px, 0); }
              36.3636363636% { transform: translate(12px, 0); }
              45.4545454545% { transform: translate(12px, 12px); }
              54.5454545455% { transform: translate(12px, 12px); }
              63.6363636364% { transform: translate(12px, 12px); }
              72.7272727273% { transform: translate(12px, 0px); }
              81.8181818182% { transform: translate(0px, 0px); }
              90.9090909091% { transform: translate(-12px, 0px); }
              100% { transform: translate(0px, 0px); }
            }
            .spinner-box:nth-child(1) { animation: moveBox-1 4s infinite; }

            @keyframes moveBox-2 {
              9.0909090909% { transform: translate(0, 0); }
              18.1818181818% { transform: translate(12px, 0); }
              27.2727272727% { transform: translate(0px, 0); }
              36.3636363636% { transform: translate(12px, 0); }
              45.4545454545% { transform: translate(12px, 12px); }
              54.5454545455% { transform: translate(12px, 12px); }
              63.6363636364% { transform: translate(12px, 12px); }
              72.7272727273% { transform: translate(12px, 12px); }
              81.8181818182% { transform: translate(0px, 12px); }
              90.9090909091% { transform: translate(0px, 12px); }
              100% { transform: translate(0px, 0px); }
            }
            .spinner-box:nth-child(2) { animation: moveBox-2 4s infinite; }

            @keyframes moveBox-3 {
              9.0909090909% { transform: translate(-12px, 0); }
              18.1818181818% { transform: translate(-12px, 0); }
              27.2727272727% { transform: translate(0px, 0); }
              36.3636363636% { transform: translate(-12px, 0); }
              45.4545454545% { transform: translate(-12px, 0); }
              54.5454545455% { transform: translate(-12px, 0); }
              63.6363636364% { transform: translate(-12px, 0); }
              72.7272727273% { transform: translate(-12px, 0); }
              81.8181818182% { transform: translate(-12px, -12px); }
              90.9090909091% { transform: translate(0px, -12px); }
              100% { transform: translate(0px, 0px); }
            }
            .spinner-box:nth-child(3) { animation: moveBox-3 4s infinite; }

            @keyframes moveBox-4 {
              9.0909090909% { transform: translate(-12px, 0); }
              18.1818181818% { transform: translate(-12px, 0); }
              27.2727272727% { transform: translate(-12px, -12px); }
              36.3636363636% { transform: translate(0px, -12px); }
              45.4545454545% { transform: translate(0px, 0px); }
              54.5454545455% { transform: translate(0px, -12px); }
              63.6363636364% { transform: translate(0px, -12px); }
              72.7272727273% { transform: translate(0px, -12px); }
              81.8181818182% { transform: translate(-12px, -12px); }
              90.9090909091% { transform: translate(-12px, 0px); }
              100% { transform: translate(0px, 0px); }
            }
            .spinner-box:nth-child(4) { animation: moveBox-4 4s infinite; }

            @keyframes moveBox-5 {
              9.0909090909% { transform: translate(0, 0); }
              18.1818181818% { transform: translate(0, 0); }
              27.2727272727% { transform: translate(0, 0); }
              36.3636363636% { transform: translate(12px, 0); }
              45.4545454545% { transform: translate(12px, 0); }
              54.5454545455% { transform: translate(12px, 0); }
              63.6363636364% { transform: translate(12px, 0); }
              72.7272727273% { transform: translate(12px, 0); }
              81.8181818182% { transform: translate(12px, -12px); }
              90.9090909091% { transform: translate(0px, -12px); }
              100% { transform: translate(0px, 0px); }
            }
            .spinner-box:nth-child(5) { animation: moveBox-5 4s infinite; }

            @keyframes moveBox-6 {
              9.0909090909% { transform: translate(0, 0); }
              18.1818181818% { transform: translate(-12px, 0); }
              27.2727272727% { transform: translate(-12px, 0); }
              36.3636363636% { transform: translate(0px, 0); }
              45.4545454545% { transform: translate(0px, 0); }
              54.5454545455% { transform: translate(0px, 0); }
              63.6363636364% { transform: translate(0px, 0); }
              72.7272727273% { transform: translate(0px, 12px); }
              81.8181818182% { transform: translate(-12px, 12px); }
              90.9090909091% { transform: translate(-12px, 0px); }
              100% { transform: translate(0px, 0px); }
            }
            .spinner-box:nth-child(6) { animation: moveBox-6 4s infinite; }

            @keyframes moveBox-7 {
              9.0909090909% { transform: translate(12px, 0); }
              18.1818181818% { transform: translate(12px, 0); }
              27.2727272727% { transform: translate(12px, 0); }
              36.3636363636% { transform: translate(0px, 0); }
              45.4545454545% { transform: translate(0px, -12px); }
              54.5454545455% { transform: translate(12px, -12px); }
              63.6363636364% { transform: translate(0px, -12px); }
              72.7272727273% { transform: translate(0px, -12px); }
              81.8181818182% { transform: translate(0px, 0px); }
              90.9090909091% { transform: translate(12px, 0px); }
              100% { transform: translate(0px, 0px); }
            }
            .spinner-box:nth-child(7) { animation: moveBox-7 4s infinite; }

            @keyframes moveBox-8 {
              9.0909090909% { transform: translate(0, 0); }
              18.1818181818% { transform: translate(-12px, 0); }
              27.2727272727% { transform: translate(-12px, -12px); }
              36.3636363636% { transform: translate(0px, -12px); }
              45.4545454545% { transform: translate(0px, -12px); }
              54.5454545455% { transform: translate(0px, -12px); }
              63.6363636364% { transform: translate(0px, -12px); }
              72.7272727273% { transform: translate(0px, -12px); }
              81.8181818182% { transform: translate(12px, -12px); }
              90.9090909091% { transform: translate(12px, 0px); }
              100% { transform: translate(0px, 0px); }
            }
            .spinner-box:nth-child(8) { animation: moveBox-8 4s infinite; }

            @keyframes moveBox-9 {
              9.0909090909% { transform: translate(-12px, 0); }
              18.1818181818% { transform: translate(-12px, 0); }
              27.2727272727% { transform: translate(0px, 0); }
              36.3636363636% { transform: translate(-12px, 0); }
              45.4545454545% { transform: translate(0px, 0); }
              54.5454545455% { transform: translate(0px, 0); }
              63.6363636364% { transform: translate(-12px, 0); }
              72.7272727273% { transform: translate(-12px, 0); }
              81.8181818182% { transform: translate(-24px, 0); }
              90.9090909091% { transform: translate(-12px, 0); }
              100% { transform: translate(0px, 0); }
            }
            .spinner-box:nth-child(9) { animation: moveBox-9 4s infinite; }
          `}
        </style>
        <g>
          <circle className="spinner-box" cx="13" cy="1" r="5" />
          <circle className="spinner-box" cx="13" cy="1" r="5" />
          <circle className="spinner-box" cx="25" cy="25" r="5" />
          <circle className="spinner-box" cx="13" cy="13" r="5" />
          <circle className="spinner-box" cx="13" cy="13" r="5" />
          <circle className="spinner-box" cx="25" cy="13" r="5" />
          <circle className="spinner-box" cx="1" cy="25" r="5" />
          <circle className="spinner-box" cx="13" cy="25" r="5" />
          <circle className="spinner-box" cx="25" cy="25" r="5" />
        </g>
      </svg>
    </div>
  );
}
