import { Link, NavLink } from 'react-router'
import { cx } from '../../styles/classes'
import { INSTITUTIONS } from '../../data/contact'
import VoiceGuide from './VoiceGuide'

// Sticky top bar: the app logo with the partner institutions, the voice guide
// button, and one tab per module. The tab of the page you are on is a solid
// accent pill (NavLink also sets aria-current="page").

// The "Listen" voice guide (VoiceGuide.jsx) is hidden for now; set to true to show it again.
const SHOW_VOICE_GUIDE = false

const TABS = [
  ['/', 'Vegetation'],
  ['/disaster', 'Disaster'],
]

export default function Nav() {
  return (
    // Translucent page colour with a blur, so content scrolling underneath stays faintly visible
    <nav
      className="sticky top-[env(safe-area-inset-top,0px)] z-[1000] border-b border-line bg-[color-mix(in_srgb,var(--bg)_88%,transparent)] backdrop-blur-[10px]"
      aria-label="Main"
    >
      <div className="mx-auto flex max-w-[1180px] items-center justify-between gap-4 px-5 py-2.5">
        <Link className="flex items-center gap-2.5 font-display text-[19px] font-semibold whitespace-nowrap text-ink no-underline" to="/">
          <svg className="flex-none" width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
            <circle cx="15" cy="15" r="14" fill="var(--accent-soft)" />
            <path d="M9 20c0-7 5-11 13-12-1 8-5 13-12 13" fill="var(--accent)" />
            <path d="M10 21c3-4 6-7 10-10" stroke="var(--surface)" strokeWidth="1.4" fill="none" strokeLinecap="round" />
          </svg>
          {/* The name hides on narrow screens so the tabs get the room */}
          <span className="max-[761px]:hidden">Competition Web App</span>
        </Link>
        {/* Partner institutions (text until the logo files are added); only on wide screens */}
        <span className="mr-auto hidden border-l border-line pl-4 text-[13px] leading-tight text-muted min-[1100px]:block">
          {INSTITUTIONS.map((i) => (
            <span key={i.short} className="block">
              {i.short}
            </span>
          ))}
        </span>
        {SHOW_VOICE_GUIDE && <VoiceGuide className="ml-auto" />}
        <div className="flex gap-0.5">
          {TABS.map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              // "end" so the Vegetation tab ("/") isn't also active on /disaster
              end
              className={({ isActive }) =>
                cx(
                  'rounded-full px-3 py-[7px] text-[14px] font-medium whitespace-nowrap no-underline',
                  // The active tab keeps its accent colours on hover
                  isActive ? 'bg-accent text-on-accent' : 'text-muted hover:bg-accent-soft hover:text-ink',
                )
              }
            >
              {label}
            </NavLink>
          ))}
        </div>
      </div>
    </nav>
  )
}
