import { createContext, useContext } from 'react'

// App-wide state shared by several sections. Provided by <AppProvider>.
//   city:     id of the selected city (one of CITY_IDS in lib/store.js)
//   setCity:  select a city; every section, including the map, follows it
//   focusSeq: counter bumped on every setCity call, even for the current city
//             (the map uses it to recentre)
//   toast:    show a short message at the bottom of the screen
export const AppContext = createContext(null)

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>')
  return ctx
}
