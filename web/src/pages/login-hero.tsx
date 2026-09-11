/**
 * Decorative cluster mesh & fabric topology art for the login split pane.
 * Follows Fluid Functionalism dark substrate and elevation glow standards.
 */
export function LoginHeroArt() {
  return (
    <svg
      aria-hidden="true"
      className="absolute inset-0 h-full w-full select-none"
      viewBox="0 0 800 1200"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id="login-sky" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#04090e" />
          <stop offset="45%" stopColor="#091624" />
          <stop offset="100%" stopColor="#0d2338" />
        </linearGradient>
        <radialGradient id="login-glow-primary" cx="42%" cy="38%" r="62%">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.32" />
          <stop offset="40%" stopColor="#0284c7" stopOpacity="0.14" />
          <stop offset="100%" stopColor="#04090e" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="login-glow-secondary" cx="70%" cy="75%" r="55%">
          <stop offset="0%" stopColor="#34d399" stopOpacity="0.2" />
          <stop offset="50%" stopColor="#059669" stopOpacity="0.06" />
          <stop offset="100%" stopColor="#04090e" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="login-line" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#7dd3fc" stopOpacity="0.18" />
          <stop offset="50%" stopColor="#38bdf8" stopOpacity="0.65" />
          <stop offset="100%" stopColor="#6ee7b7" stopOpacity="0.25" />
        </linearGradient>
        <linearGradient id="pulse-gradient" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0" />
          <stop offset="50%" stopColor="#bae6fd" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
        </linearGradient>
        <filter id="login-soft" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="12" />
        </filter>
        <filter id="glow-filter" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      {/* Substrate backgrounds */}
      <rect width="800" height="1200" fill="url(#login-sky)" />
      <rect width="800" height="1200" fill="url(#login-glow-primary)" />
      <rect width="800" height="1200" fill="url(#login-glow-secondary)" />

      {/* Substrate grid lattice */}
      <g opacity="0.15" stroke="#7dd3fc" strokeWidth="0.5" fill="none">
        {Array.from({ length: 20 }, (_, i) => (
          <line key={`v-${i}`} x1={20 + i * 40} y1="0" x2={20 + i * 40} y2="1200" />
        ))}
        {Array.from({ length: 28 }, (_, i) => (
          <line key={`h-${i}`} x1="0" y1={20 + i * 44} x2="800" y2={20 + i * 44} />
        ))}
      </g>

      {/* Ambient ambient glow orbs */}
      <g filter="url(#login-soft)" opacity="0.45">
        <circle cx="260" cy="380" r="110" fill="#0284c7" />
        <circle cx="560" cy="640" r="95" fill="#059669" />
        <circle cx="420" cy="500" r="140" fill="#0369a1" />
      </g>

      {/* Fabric topology connecting lines */}
      <g fill="none" stroke="url(#login-line)" strokeWidth="1.5">
        <path d="M180 280 L320 360 L260 520 L420 480 L540 360 L620 520 L480 680 L320 640 L180 520 Z" />
        <path d="M320 360 L420 240 L540 360" />
        <path d="M260 520 L180 720 L320 640" />
        <path d="M540 360 L680 280 L620 520" />
        <path d="M420 480 L480 680" strokeDasharray="3 4" strokeOpacity="0.5" />
        <path d="M320 360 L420 480" strokeDasharray="4 4" strokeOpacity="0.6" />
        <path d="M420 480 L620 520" strokeDasharray="3 4" strokeOpacity="0.5" />

        {/* Concentric fabric broadcast rings around central hub */}
        <circle cx="420" cy="480" r="118" strokeOpacity="0.28" />
        <circle cx="420" cy="480" r="188" strokeOpacity="0.14" strokeDasharray="4 6" />
        <circle cx="420" cy="480" r="268" strokeOpacity="0.08" />
      </g>

      {/* Topology Nodes */}
      {[
        [180, 280, 9, "Node 01"],
        [320, 360, 11, "Relay A"],
        [420, 240, 8, "Edge"],
        [540, 360, 12, "Relay B"],
        [680, 280, 7, "Worker 04"],
        [260, 520, 10, "Worker 01"],
        [420, 480, 15, "EasyTier Hub"],
        [620, 520, 10, "Worker 03"],
        [180, 720, 8, "Worker 02"],
        [320, 640, 10, "Storage"],
        [480, 680, 11, "Compute"],
      ].map(([x, y, r], i) => (
        <g key={`${x}-${y}`} filter="url(#glow-filter)">
          {/* Subtle pulse halo */}
          <circle cx={x} cy={y} r={Number(r) + 8} fill="#38bdf8" opacity="0.15">
            <animate
              attributeName="opacity"
              values="0.06;0.25;0.06"
              dur={`${3.2 + (i % 4) * 0.5}s`}
              repeatCount="indefinite"
            />
            <animate
              attributeName="r"
              values={`${Number(r) + 4};${Number(r) + 12};${Number(r) + 4}`}
              dur={`${3.2 + (i % 4) * 0.5}s`}
              repeatCount="indefinite"
            />
          </circle>
          {/* Main node core */}
          <circle
            cx={x}
            cy={y}
            r={r}
            fill="#e0f2fe"
            stroke="#38bdf8"
            strokeWidth="1.8"
          />
          <circle cx={x} cy={y} r={Math.max(2, Number(r) - 4)} fill="#0284c7" />
        </g>
      ))}
    </svg>
  );
}
