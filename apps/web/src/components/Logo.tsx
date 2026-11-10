/** RecallFarm mark: concentric rings (vaccination cycle) + live dot. From Main.dc.html. */
export function LogoMark({ size = 30, live = true }: { size?: number; live?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" aria-hidden="true" focusable="false">
      <circle cx="15" cy="15" r="13.5" fill="none" stroke="#C8F169" strokeWidth="1.5" />
      <circle cx="15" cy="15" r="7.5" fill="none" stroke="#C8F169" strokeWidth="1.5" strokeDasharray="3 3" />
      <circle cx="15" cy="15" r="2.6" fill="#C8F169" />
      {live && <circle cx="26.2" cy="9" r="2" fill="#8FE3FF" />}
    </svg>
  );
}
