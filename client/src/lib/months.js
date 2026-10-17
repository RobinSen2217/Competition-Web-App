import { M } from './store'

export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// i is an index into M (the store's monthly time axis)
export const mLabel = (i) => MON[+M[i].slice(5) - 1] + ' ' + M[i].slice(0, 4)
export const mOf = (i) => +M[i].slice(5) - 1
export const yOf = (i) => +M[i].slice(0, 4)

export const YEARS = [...new Set(M.map((m) => +m.slice(0, 4)))]
export const FIRST_YEAR = YEARS[0]
export const LAST_YEAR = YEARS[YEARS.length - 1]
