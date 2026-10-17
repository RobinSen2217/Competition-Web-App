// Placeholder heights of the flood page's lazy sections: each card's real
// height by viewport width, [[width, height], ...], interpolated between the
// points (LazySection -> lib/sectionHeights.js heightAt). Measured in Chrome
// with the default event selected (scripts in the harness, see the client
// README), so the page keeps its final length while sections mount and an
// #anchor jump lands in the right place. Re-measure after changing a
// section's layout; a few dozen px off only means a small shift on arrival.
export const FLOOD_HEIGHTS = {
  map: [[320, 1300], [390, 1264], [900, 1100], [901, 634], [1280, 634]],
  parameters: [[320, 1640], [390, 1601], [1280, 1087]],
  forecast: [[320, 2700], [390, 2592], [1280, 1461]],
  method: [[320, 4200], [390, 3921], [1280, 1842]],
}
