// Layer catalog: what each map layer means, independent of any one area.
// A provider reports which layers an area has and supplies the per-area parts
// (bounds, time interval and available times, image paths, value grids); the
// service merges those with the definitions here to build the public Layer
// object. Nothing here is tied to a particular area.
//
// To add a layer type: add a definition to LAYER_DEFS and have the provider
// report it for the areas that have it (the files provider: a RASTER_LAYERS
// row in providers/files.js, or a record in data/layers.extra.json for a
// one-off image such as the Sentinel-2 export of Jaisalmer).
//
// values.scale: multiply the stored integers by this to get `unit` values.
// values: null means the layer is an image only (no numbers behind it).
// parameter: the /parameters key the layer shows, or null when it has no series
// counterpart (e.g. the Sentinel-2 water and built-up indices).

const LAYER_DEFS = {
  'ndvi-peak': {
    title: 'Greenness (monsoon peak)', parameter: 'ndvi', kind: 'raster', resolution: '250m', source: 'MODIS MOD13Q1',
    description: 'Monsoon-peak NDVI for each year from MODIS 250 m pixels.',
    values: { scale: 0.001, unit: '' },
  },
  'ndvi-change': {
    title: 'Greenness change since 2010–12', parameter: 'ndvi', kind: 'raster', resolution: '250m', source: 'MODIS MOD13Q1',
    description: 'Average monsoon-peak NDVI of 2023–25 minus that of 2010–12. Positive = gained vegetation.',
    values: { scale: 0.001, unit: '' },
  },
  'lst-day-summer': {
    title: 'Summer heat, day', parameter: 'lst_day', kind: 'raster', resolution: '1km', source: 'MODIS MOD11A2',
    description: 'Average April–June daytime land surface temperature, 2022–2026, from MODIS 1 km pixels.',
    values: { scale: 0.1, unit: '°C' },
  },
  'lst-night-summer': {
    title: 'Summer heat, night', parameter: 'lst_night', kind: 'raster', resolution: '1km', source: 'MODIS MOD11A2',
    description: 'Average April–June night-time land surface temperature, 2022–2026, from MODIS 1 km pixels.',
    values: { scale: 0.1, unit: '°C' },
  },
  's2-ndvi': {
    title: 'NDVI 10 m', parameter: 'ndvi', kind: 'raster', resolution: '10m', source: 'Sentinel-2',
    description: 'Sentinel-2 10 m greenness from the Earth Engine notebook, 2 x 2 km around Gadisar Lake.',
    values: null,
  },
  's2-ndwi': {
    title: 'Water (NDWI) 10 m', parameter: null, kind: 'raster', resolution: '10m', source: 'Sentinel-2',
    description: 'Sentinel-2 normalized difference water index, 2 x 2 km around Gadisar Lake.',
    values: null,
  },
  's2-ndbi': {
    title: 'Built-up (NDBI) 10 m', parameter: null, kind: 'raster', resolution: '10m', source: 'Sentinel-2',
    description: 'Sentinel-2 normalized difference built-up index, 2 x 2 km around Gadisar Lake.',
    values: null,
  },
}

// Fallback for a layer id a provider reports but this catalog does not know yet.
const describeUnknownLayer = (id) => ({
  title: id, parameter: null, kind: 'raster', resolution: null, source: '', description: '', values: null,
})

const getLayerDef = (id) => (Object.hasOwn(LAYER_DEFS, id) ? LAYER_DEFS[id] : describeUnknownLayer(id))

module.exports = { LAYER_DEFS, getLayerDef }
