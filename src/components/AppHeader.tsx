import { BackIcon, SettingsIcon } from '../shared/icons'

interface Props {
  title?: string
  subtitle?: string
  back?: () => void
  settings?: () => void
}

export function AppHeader({ title = 'StepLink', subtitle, back, settings }: Props) {
  return (
    <header className="app-header">
      <div className="header-side">
        {back ? <button className="icon-button" onClick={back} aria-label="뒤로"><BackIcon /></button> : <img src="/brand/steplink-mark.svg" className="brand-mark" alt="" />}
      </div>
      <div className="header-title">
        <strong>{title}</strong>
        {subtitle && <span>{subtitle}</span>}
      </div>
      <div className="header-side header-side-end">
        {settings && <button className="icon-button" onClick={settings} aria-label="설정"><SettingsIcon /></button>}
      </div>
    </header>
  )
}
