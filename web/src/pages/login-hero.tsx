/** Decorative cluster mesh for the login split pane. */
export function LoginHeroArt() {
  return (
    <svg
      aria-hidden
      className="absolute inset-0 h-full w-full"
      viewBox="0 0 800 1200"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id="login-sky" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#071018" />
          <stop offset="45%" stopColor="#0c1c2c" />
          <stop offset="100%" stopColor="#12324a" />
        </linearGradient>
        <radialGradient id="login-glow" cx="42%" cy="38%" r="58%">
          <stop offset="0%" stopColor="#5b9fd4" stopOpacity="0.38" />
          <stop offset="55%" stopColor="#2b7bb8" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#071018" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="login-line" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#7ec8ff" stopOpacity="0.15" />
          <stop offset="50%" stopColor="#5b9fd4" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#98c379" stopOpacity="0.2" />
        </linearGradient>
        <filter id="login-soft" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="8" />
        </filter>
      </defs>

      <rect width="800" height="1200" fill="url(#login-sky)" />
      <rect width="800" height="1200" fill="url(#login-glow)" />

      <g opacity="0.22" stroke="#7ec8ff" strokeWidth="0.6" fill="none">
        {Array.from({ length: 18 }, (_, i) => (
          <line key={`v-${i}`} x1={40 + i * 42} y1="0" x2={40 + i * 42} y2="1200" />
        ))}
        {Array.from({ length: 26 }, (_, i) => (
          <line key={`h-${i}`} x1="0" y1={30 + i * 46} x2="800" y2={30 + i * 46} />
        ))}
      </g>

      <g filter="url(#login-soft)" opacity="0.55">
        <circle cx="260" cy="360" r="90" fill="#5b9fd4" />
        <circle cx="540" cy="620" r="70" fill="#3d8b57" />
      </g>

      <g fill="none" stroke="url(#login-line)" strokeWidth="1.6">
        <path d="M180 280 L320 360 L260 520 L420 480 L540 360 L620 520 L480 680 L320 640 L180 520 Z" />
        <path d="M320 360 L420 240 L540 360" />
        <path d="M260 520 L180 720 L320 640" />
        <path d="M540 360 L680 280 L620 520" />
        <circle cx="420" cy="480" r="118" strokeOpacity="0.35" />
        <circle cx="420" cy="480" r="188" strokeOpacity="0.18" />
        <circle cx="420" cy="480" r="268" strokeOpacity="0.1" />
      </g>

      {[
        [180, 280, 10],
        [320, 360, 12],
        [420, 240, 9],
        [540, 360, 13],
        [680, 280, 8],
        [260, 520, 11],
        [420, 480, 16],
        [620, 520, 10],
        [180, 720, 9],
        [320, 640, 11],
        [480, 680, 12],
      ].map(([x, y, r], i) => (
        <g key={`${x}-${y}`}>
          <circle cx={x} cy={y} r={r + 8} fill="#5b9fd4" opacity="0.16">
            <animate
              attributeName="opacity"
              values="0.08;0.28;0.08"
              dur={`${3.2 + (i % 4) * 0.4}s`}
              repeatCount="indefinite"
            />
          </circle>
          <circle cx={x} cy={y} r={r} fill="#d7ecff" stroke="#7ec8ff" strokeWidth="1.5" />
        </g>
      ))}

      <g transform="translate(248 820)">
        <rect width="304" height="86" rx="16" fill="#12202e" fillOpacity="0.72" stroke="#5b9fd4" strokeOpacity="0.35" />
        <rect x="18" y="20" width="48" height="46" rx="8" fill="#2b7bb8" opacity="0.9" />
        <rect x="80" y="24" width="160" height="10" rx="5" fill="#e7eef6" opacity="0.85" />
        <rect x="80" y="46" width="196" height="8" rx="4" fill="#8aa0b5" opacity="0.7" />
      </g>
    </svg>
  );
}
