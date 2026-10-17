/*
  Real heights of the lazily mounted cards, by viewport width, so a section's
  placeholder (LazySection) and the forecast's skeleton (ModelForecast) take
  the space the loaded card will take. With the page keeping its final length,
  nothing jumps when sections mount above the reader, e.g. when scrolling up
  after an #anchor jump.

  Each table is [[viewportWidth, cardHeight], ...], sorted by width; heightAt()
  interpolates linearly between points and clamps outside them. Heights step
  at the layout's breakpoints (420, 464, 481, 521, 540, 640, 700, 761, 768,
  848, 901, 1024px) and drift in between as text wraps, so a few points per
  breakpoint are needed; two points 1-10px apart encode a step.

  How they were measured (production build, both data sources gave identical
  numbers): every section mounted and loaded, then the window resized from 320
  to 1440px in 10px steps (plus each breakpoint +-1px), for each of the six
  cities; the median over the cities was kept, then thinned to the fewest
  points whose interpolation stays within 12px of every measurement. Cities
  differ by up to ~60px (features), ~110px (map) and ~170px (forecast, on
  phones) from the median, so a few px of movement remains for some cities.

  Re-measure after changing a card's layout: in Chrome's responsive mode, at a
  few widths, scroll to the bottom, wait for the loaders, and run
    ['glance','features','why','compare','where','plot','mlforecast'].map((id) => document.getElementById(id).offsetHeight)
  then update the points around the widths that changed.
*/
export const SECTION_HEIGHTS = {
  glance: [[320, 1074], [410, 1074], [421, 1052], [440, 1052], [450, 665], [482, 665], [490, 643], [530, 643], [550, 622], [641, 624], [660, 647], [770, 654], [790, 611], [840, 614], [847, 423], [1025, 435], [1030, 414], [1440, 417]],
  features: [[320, 4582], [340, 4510], [360, 4489], [370, 4445], [401, 4445], [410, 2880], [421, 2880], [430, 2838], [450, 2817], [463, 2763], [464, 2708], [470, 2688], [480, 2688], [481, 2648], [510, 2648], [521, 2536], [570, 2525], [580, 2257], [620, 2216], [630, 2217], [639, 2195], [641, 2171], [660, 2150], [680, 2092], [701, 2061], [740, 2063], [750, 1981], [761, 1963], [762, 1899], [800, 1901], [821, 1882], [880, 1822], [902, 1783], [940, 1776], [950, 1590], [990, 1593], [1025, 1578], [1060, 1579], [1080, 1555], [1090, 1515], [1110, 1497], [1120, 1298], [1140, 1277], [1170, 1278], [1200, 1260], [1440, 1260]],
  why: [[320, 1454], [360, 1258], [380, 1235], [399, 1190], [401, 1170], [430, 1103], [464, 1080], [465, 1056], [470, 1032], [490, 1032], [510, 991], [520, 991], [522, 970], [530, 970], [550, 918], [561, 870], [690, 875], [701, 853], [710, 853], [720, 809], [762, 811], [770, 788], [900, 796], [901, 623], [930, 625], [950, 604], [1080, 611], [1090, 582], [1130, 560], [1150, 538], [1440, 538]],
  compare: [[320, 644], [381, 644], [390, 619], [701, 625], [710, 601], [930, 614], [940, 572], [1440, 582]],
  where: [[320, 1678], [350, 1613], [370, 1613], [381, 1551], [410, 1551], [421, 1494], [440, 1494], [450, 1448], [500, 1440], [510, 1412], [522, 1412], [530, 1387], [550, 1387], [570, 1367], [610, 1348], [670, 1351], [680, 1327], [720, 1330], [730, 1293], [900, 1303], [901, 846], [1440, 859]],
  plot: [[320, 1797], [340, 1777], [350, 1708], [360, 1708], [370, 1680], [380, 1606], [401, 1560], [410, 1522], [450, 1522], [464, 1485], [500, 1485], [510, 1448], [530, 1448], [541, 1411], [570, 1387], [590, 1342], [650, 1345], [660, 1308], [900, 1323], [901, 1100], [960, 1105], [970, 1022], [1440, 1029]],
  mlforecast: [[320, 3574], [330, 3370], [340, 3280], [350, 3255], [360, 3198], [370, 3093], [379, 3071], [380, 3043], [400, 2893], [401, 2866], [410, 2858], [421, 2799], [440, 2777], [450, 2731], [460, 2608], [463, 2597], [465, 2577], [482, 2530], [500, 2510], [521, 2447], [541, 2437], [550, 2360], [559, 2313], [561, 2265], [580, 2265], [590, 2233], [610, 2212], [640, 2172], [641, 2151], [701, 2112], [710, 2069], [730, 2048], [750, 2003], [767, 2004], [768, 1877], [810, 1843], [860, 1846], [890, 1784], [902, 1785], [910, 1763], [940, 1766], [980, 1729], [1024, 1722], [1080, 1670], [1130, 1671], [1150, 1650], [1440, 1650]],
}

/**
 * Height for viewport width `w` from a table above (linear between points,
 * clamped outside them).
 * @param {[number, number][]} table
 * @param {number} w  viewport width in CSS px (window.innerWidth)
 * @returns {number | undefined}
 */
export function heightAt(table, w) {
  if (!table?.length) return undefined
  if (w <= table[0][0]) return table[0][1]
  for (let i = 1; i < table.length; i++) {
    const [w1, h1] = table[i]
    if (w <= w1) {
      const [w0, h0] = table[i - 1]
      return Math.round(h0 + ((h1 - h0) * (w - w0)) / (w1 - w0))
    }
  }
  return table[table.length - 1][1]
}
