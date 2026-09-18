type P = { size?: number; color?: string };
const S = ({ size = 16, color = "currentColor", children }: P & { children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    {children}
  </svg>
);
export const IconBack = (p: P) => <S {...p}><path d="M19 12H5M11 18l-6-6 6-6" /></S>;
export const IconNow = (p: P) => <S {...p}><path d="M5 12h14M13 6l6 6-6 6" /></S>;
export const IconClock = (p: P) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></S>;
export const IconSend = (p: P) => <S {...p}><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" /></S>;
export const IconTarget = (p: P) => <S {...p}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /></S>;
export const IconMail = (p: P) => <S {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></S>;
export const IconTab = (p: P) => <S {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M8 4v5" /></S>;
export const IconBell = (p: P) => <S {...p}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" /></S>;
