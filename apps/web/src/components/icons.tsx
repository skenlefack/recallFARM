/** Icons copied from the designs (24px nav icons, 18px header icons). */
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

const nav = (paths: React.ReactNode) =>
  function NavIcon({ size = 20, ...p }: P) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" {...p}>
        {paths}
      </svg>
    );
  };

export const IconDashboard = nav(
  <>
    <rect x="3" y="3" width="7" height="8" rx="2" />
    <rect x="14" y="3" width="7" height="5" rx="2" />
    <rect x="3" y="15" width="7" height="6" rx="2" />
    <rect x="14" y="12" width="7" height="9" rx="2" />
  </>,
);
export const IconFarm = nav(
  <>
    <path d="M3 11l9-7 9 7" />
    <path d="M5 9.5V20h14V9.5" />
    <path d="M10 20v-5h4v5" />
  </>,
);
export const IconBell = nav(
  <>
    <path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z" />
    <path d="M10 21h4" />
  </>,
);
export const IconAlert = nav(
  <>
    <path d="M12 3l9.5 17h-19z" />
    <path d="M12 10v4.5M12 17.5v.2" />
  </>,
);
export const IconCampaign = nav(
  <>
    <path d="M4 10v4l11 4V6L4 10z" />
    <path d="M15 9.5a3 3 0 0 1 0 5M7 14.5l1 4.5h3l-1-3.5" />
  </>,
);
export const IconMap = nav(<path d="M9 4l-6 2.5v13.5l6-2.5 6 2.5 6-2.5V3.5l-6 2.5z M9 4v13.5M15 6v13.5" />);
export const IconSliders = nav(
  <>
    <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
    <circle cx="16" cy="6" r="2" />
    <circle cx="10" cy="12" r="2" />
    <circle cx="18" cy="18" r="2" />
  </>,
);
export const IconCard = nav(
  <>
    <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
    <path d="M3 10h18M7 15h4" />
  </>,
);
export const IconReceipt = nav(<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3zM9 8h6M9 12h6" />);
export const IconDownload = nav(
  <>
    <path d="M12 3v12M7.5 10.5L12 15l4.5-4.5" />
    <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </>,
);
export const IconUsers = nav(
  <>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c.8-3.5 3.5-5.5 6.5-5.5s5.7 2 6.5 5.5" />
    <path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c1.8.8 3 2.6 3.5 5.2" />
  </>,
);
/* studio objects */
export const IconPaw = nav(
  <>
    <circle cx="6" cy="10" r="2" />
    <circle cx="10" cy="5.5" r="2" />
    <circle cx="14.5" cy="5.5" r="2" />
    <circle cx="18.5" cy="10" r="2" />
    <path d="M12 12c-3 0-5.5 3.5-5.5 5.5 0 1.8 1.5 2.5 3 2.2 1-.2 1.7-.7 2.5-.7s1.5.5 2.5.7c1.5.3 3-.4 3-2.2 0-2-2.5-5.5-5.5-5.5z" />
  </>,
);
export const IconSyringe = nav(<path d="M15 3l6 6M18 6l-9.5 9.5-3-3L15 3M9 9l2 2M11.5 6.5l2 2M5.5 12.5l-2.5 2.5v3h3l2.5-2.5M3 21l3-3" />);
export const IconForm = nav(
  <>
    <rect x="4" y="3" width="16" height="18" rx="2.5" />
    <path d="M8 8h8M8 12h8M8 16h5" />
  </>,
);
export const IconBars = nav(<path d="M4 20V10M10 20V4M16 20v-7M21 20H3" />);
export const IconGauge = nav(
  <>
    <path d="M4 17a8 8 0 1 1 16 0" />
    <path d="M12 17l4-5" />
    <circle cx="12" cy="17" r="1.3" />
  </>,
);
export const IconCalendar = nav(
  <>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
    <path d="M3.5 10h17M8 3v4M16 3v4M8 14h2M14 14h2" />
  </>,
);
export const IconSensor = nav(
  <>
    <circle cx="12" cy="14" r="2" />
    <path d="M8.5 10.5a5 5 0 0 1 7 0M5.5 7.5a9 9 0 0 1 13 0M12 16v5" />
  </>,
);
export const IconTrend = nav(
  <>
    <path d="M3 17l6-6 4 4 8-8" />
    <path d="M15 7h6v6" />
  </>,
);
export const IconGlobe = nav(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z" />
  </>,
);
export const IconBack = nav(<path d="M15 5l-7 7 7 7" />);
export const IconPackages = nav(
  <>
    <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
    <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />
  </>,
);

const head = (paths: React.ReactNode) =>
  function HeadIcon({ size = 18, ...p }: P) {
    return (
      <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...p}>
        {paths}
      </svg>
    );
  };
export const HSync = head(<path d="M3 9a6 6 0 0 1 10.4-4.1L15 6.5M15 3v3.5h-3.5M15 9a6 6 0 0 1-10.4 4.1L3 11.5M3 15v-3.5h3.5" />);
export const HBell = head(<path d="M4.5 13V8.5a4.5 4.5 0 0 1 9 0V13l1.5 1.5H3z M7.5 16.5h3" />);
export const HHelp = head(
  <>
    <circle cx="9" cy="9" r="7" />
    <path d="M7 7a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.2v.5M9 13v.2" />
  </>,
);
export const HGear = head(
  <>
    <circle cx="9" cy="9" r="2.4" />
    <path d="M9 1.8v2M9 14.2v2M1.8 9h2M14.2 9h2M3.9 3.9l1.4 1.4M12.7 12.7l1.4 1.4M3.9 14.1l1.4-1.4M12.7 5.3l1.4-1.4" />
  </>,
);
export const HSearch = head(
  <>
    <path d="M11 11l4.5 4.5" />
    <circle cx="7.5" cy="7.5" r="5" />
  </>,
);
export const HChevron = ({ size = 14, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true" {...p}>
    <path d="M3.5 5.5L7 9l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);
export const Check = ({ size = 16, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" {...p}>
    <path d="M2 8.5l4 4 8-9" fill="none" stroke="currentColor" strokeWidth="1.6" />
  </svg>
);
export const Close = ({ size = 16, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" {...p}>
    <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);
