import { createContext, useContext } from 'react'

// Selection shared by every section of a hazard page: which hazard, which of
// its events. Provided by the page (pages/FloodPage.jsx), which keeps the
// event in the URL (?event=<id>) so a view can be shared or reloaded.
//   hazard      hazard id ('flood')
//   eventId     selected event id, or null until the event list is in
//   setEventId  select an event; every section follows
//   events      the hazard's event list sorted by start date, or undefined while it loads
export const HazardContext = createContext(null)

export function useHazardPage() {
  const ctx = useContext(HazardContext)
  if (!ctx) throw new Error('useHazardPage must be used inside a hazard page')
  return ctx
}
