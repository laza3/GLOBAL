export function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <linearGradient id="gpg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ecd48f" /><stop offset="1" stopColor="#c08f26" /></linearGradient>
      </defs>
      <rect width="48" height="48" rx="13" fill="#0f1630" />
      <rect x="1" y="1" width="46" height="46" rx="12" fill="none" stroke="url(#gpg)" strokeOpacity=".5" />
      <path d="M31 17.2A10.5 10.5 0 1 0 31 30.8M24.5 24H32v7" fill="none" stroke="url(#gpg)" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
