import type { ReactNode, SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>
const Icon = ({ children, ...props }: IconProps & { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{children}</svg>
)
export const FootIcon = (props: IconProps) => <Icon {...props}><path d="M7.7 13.4c-1.3 1.1-2.1 3.2-1.1 4.9 1 1.6 3.4 1.8 5.1.7 1.8-1.2 2-3.7.8-5.2-1.1-1.4-3.4-1.6-4.8-.4Z"/><circle cx="8" cy="7.2" r="1.2"/><circle cx="11.2" cy="5.4" r="1.1"/><circle cx="14.2" cy="5.6" r="1"/><circle cx="16.5" cy="7.5" r=".9"/></Icon>
export const RunIcon = (props: IconProps) => <Icon {...props}><circle cx="15" cy="4" r="2"/><path d="m13 8-3 4 4 2 2 6M9 20l2-5M13 8l4 3 3-1M10 12l-4-1"/></Icon>
export const GroupIcon = (props: IconProps) => <Icon {...props}><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a5 5 0 0 1 10 0v2M16 11a3 3 0 0 1 0-6M15 14a5 5 0 0 1 6 4v2"/></Icon>
export const CompassIcon = (props: IconProps) => <Icon {...props}><circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z"/></Icon>
export const SettingsIcon = (props: IconProps) => <Icon {...props}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></Icon>
export const BackIcon = (props: IconProps) => <Icon {...props}><path d="m15 18-6-6 6-6"/></Icon>
export const MapPinIcon = (props: IconProps) => <Icon {...props}><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></Icon>
export const PauseIcon = (props: IconProps) => <Icon {...props}><path d="M9 5v14M15 5v14"/></Icon>
export const PlayIcon = (props: IconProps) => <Icon {...props}><path d="m8 5 11 7-11 7V5Z"/></Icon>
export const StopIcon = (props: IconProps) => <Icon {...props}><rect x="6" y="6" width="12" height="12" rx="2"/></Icon>
export const ChevronIcon = (props: IconProps) => <Icon {...props}><path d="m9 18 6-6-6-6"/></Icon>
export const BatteryIcon = (props: IconProps) => <Icon {...props}><rect x="3" y="7" width="17" height="10" rx="2"/><path d="M22 10v4M6 10v4M10 10v4M14 10v4"/></Icon>
export const SatelliteIcon = (props: IconProps) => <Icon {...props}><path d="m5 19 4-4M3 21l2-2M14 4l6 6M12 6l6 6M8 10l6 6M5 8l11 11M16 3l5 5-4 4-5-5 4-4ZM8 10l-3 3 6 6 3-3"/></Icon>
export const HistoryIcon = (props: IconProps) => <Icon {...props}><path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6"/><path d="M4 4v4.6h4.6M12 8v4l2.7 1.7"/></Icon>
