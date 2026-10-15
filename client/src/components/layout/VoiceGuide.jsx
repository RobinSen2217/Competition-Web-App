import { useEffect, useRef, useState } from 'react'
import { cx } from '../../styles/classes'

/*
  "Listen" button in the nav: reads a short spoken tour of the website aloud
  using the browser's built-in speech (Web Speech API). No audio files and no
  network requests. Browsers without speech synthesis get no button at all.

  Behaviour notes:
  - Each sentence is its own utterance, spoken one after another, because
    Chrome silently stops a single long utterance after about 15 seconds.
  - Speech ends on Stop, at the end of the script, on a speech error, or when
    the component unmounts. The nav stays mounted across tab changes, so
    switching between Vegetation and Disaster does not interrupt it.
  - Speech deliberately keeps going when the tab is hidden, so people can
    switch tabs and keep listening; it is cancelled on pagehide (reload or
    close) so it never outlives the page.
*/

/* ==== SPOKEN SCRIPT: edit freely ====
   One short sentence per entry (each is spoken as a separate utterance).
   Keep it accurate to what the site actually has; about 60 to 80 seconds. */
const SCRIPT = [
  'Welcome to the Competition Web App.',
  'This platform uses physics-informed Earth observation to study how the environment affects population health.',
  "It is a joint project of the Malaviya National Institute of Technology Jaipur and St. Stephen's College, University of Delhi.",
  'The site has two tabs. Vegetation is available now, and Disaster is coming soon.',
  'On the Vegetation page, first pick one of six cities: Jaipur, Jodhpur, Jaisalmer, Bikaner, Udaipur or Delhi.',
  'The About section explains the project.',
  'Overview of data shows how the city is doing right now, and where the data comes from.',
  'Data analysis covers every measure: greenness, or N D V I, rainfall, air and land surface temperature, soil moisture, humidity, albedo, U V, aerosol, wind and sunshine.',
  'It also shows what drives greenness, and compares the cities with each other.',
  'Map and plot has a satellite map with yearly greenness layers, a swipe view, the history of any pixel, and an area planner, plus a plot builder with downloads.',
  'Forecast gives a statistical baseline for the next three to six months.',
  'Then come the Science behind it, answers to common questions, and how to contact the team.',
  'All data comes from NASA MODIS and NASA POWER, monthly since 2010.',
  'Thanks for listening, and enjoy exploring.',
]

// Checked once: the API either exists in this browser or it doesn't.
const SUPPORTED =
  typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window

// Preferred voice: English for India first, then British, American, any English.
function pickVoice(voices) {
  const byLang = (re) => voices.find((v) => re.test(v.lang.replace('_', '-')))
  return byLang(/^en-IN$/i) || byLang(/^en-GB$/i) || byLang(/^en-US$/i) || byLang(/^en\b/i) || null
}

function SpeakerIcon({ playing }) {
  return (
    <svg className="flex-none" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 5 6 9H3v6h3l5 4V5z" fill="currentColor" />
      {playing ? (
        // A cross while playing, hinting that pressing again stops the speech
        <path d="m16 9 5 6m0-6-5 6" />
      ) : (
        <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
      )}
    </svg>
  )
}

export default function VoiceGuide({ className }) {
  const [playing, setPlaying] = useState(false)
  // Bumped on every start/stop; callbacks from an older run see a stale id and
  // do nothing (cancel() fires onerror/onend on the utterance it interrupts).
  const runRef = useRef(0)
  // Holds the utterance being spoken: Chrome can garbage-collect an
  // unreferenced utterance and then never fire its onend.
  const uttRef = useRef(null)
  const voicesRef = useRef([])

  useEffect(() => {
    if (!SUPPORTED) return
    const synth = window.speechSynthesis
    // The ref objects are stable for the component's life; local names keep
    // the cleanup lint-clean.
    const run = runRef
    const utt = uttRef
    // Voices often load asynchronously (empty list on first call in Chrome).
    const load = () => {
      voicesRef.current = synth.getVoices()
    }
    load()
    synth.addEventListener('voiceschanged', load)
    // Also reset the button, in case the page comes back from the back/forward cache.
    const onPageHide = () => {
      run.current++
      utt.current = null
      synth.cancel()
      setPlaying(false)
    }
    window.addEventListener('pagehide', onPageHide)
    return () => {
      synth.removeEventListener('voiceschanged', load)
      window.removeEventListener('pagehide', onPageHide)
      // Unmount: stop speaking and invalidate any pending callbacks.
      run.current++
      utt.current = null
      synth.cancel()
    }
  }, [])

  if (!SUPPORTED) return null

  const stop = () => {
    runRef.current++
    uttRef.current = null
    window.speechSynthesis.cancel()
    setPlaying(false)
  }

  const start = () => {
    const synth = window.speechSynthesis
    // Clear anything already queued (e.g. from another tab of this site).
    synth.cancel()
    const run = ++runRef.current
    const voice = pickVoice(voicesRef.current.length ? voicesRef.current : synth.getVoices())

    const speak = (i) => {
      if (run !== runRef.current) return
      if (i >= SCRIPT.length) {
        uttRef.current = null
        setPlaying(false)
        return
      }
      const u = new SpeechSynthesisUtterance(SCRIPT[i])
      if (voice) u.voice = voice
      u.lang = voice ? voice.lang : 'en-IN'
      u.rate = 1
      u.onend = () => speak(i + 1)
      // A real error ends the tour; 'interrupted'/'canceled' after our own
      // cancel() are ignored by the run-id check.
      u.onerror = () => {
        if (run !== runRef.current) return
        runRef.current++
        uttRef.current = null
        setPlaying(false)
      }
      uttRef.current = u
      synth.speak(u)
    }

    setPlaying(true)
    speak(0)
  }

  const label = playing ? 'Stop' : 'Listen'

  return (
    <button
      type="button"
      onClick={playing ? stop : start}
      aria-pressed={playing}
      aria-label={playing ? 'Stop the spoken guide' : 'Listen to a short spoken guide to this website'}
      title={playing ? 'Stop the spoken guide' : 'Listen to a short guide to this website'}
      className={cx(
        'inline-flex flex-none cursor-pointer items-center gap-1.5 rounded-full border-0 px-3 py-[7px] font-body text-[14px] font-medium whitespace-nowrap hover:brightness-[1.06]',
        // Pressed state is a solid accent pill, like the active page tab
        playing ? 'bg-accent text-on-accent' : 'bg-accent-soft text-accent',
        className,
      )}
    >
      <SpeakerIcon playing={playing} />
      {/* Icon only on narrow screens; the aria-label still names the button */}
      <span className="max-[761px]:hidden">{label}</span>
    </button>
  )
}
