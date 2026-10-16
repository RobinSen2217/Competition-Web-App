// The data provider contract. Routes and services never read files or call
// upstream APIs themselves; they ask a provider. A provider adapts one data
// source (today: the JSON files in server/data; later e.g. NASA POWER or the
// MODIS subset API) to this generic model. Every method returns a Promise so a
// network-backed provider fits without changing any caller.
//
// Providers return raw facts only. Meaning (labels, units, scales) lives in
// src/catalog, validation and defaults in src/services.
//
// Areas: methods that work on an area receive the resolved AreaRecord, not a
// bare id. The services look areas up first (listAreas/getArea today) and
// pass the record on, so a provider can work from the area's geometry
// (center, bbox, boundary) instead of having to know the id. That lets areas
// come from a separate area store later (custom areas of interest drawn by
// users, see docs/API.md "Planned") while a live provider such as NASA POWER
// still answers for them. A provider must therefore not assume it created the
// area: for an area it has no data for, return empty results (all-null series,
// no layers, null boundary), not an error.
//
// This file only holds JSDoc types; it exports nothing at runtime.

/**
 * @typedef {Object} AreaRecord
 * @property {string} id                 stable, URL-safe id ("jaipur")
 * @property {string} type               "city" today; later e.g. "custom" (user-drawn area)
 * @property {string} name
 * @property {{state: string, country: string}} region
 * @property {{lat: number, lon: number}} center
 * @property {{intervals: string[], from: string|null, to: string|null, parameters: string[]}} coverage
 *           what data exists: intervals, first/last time, parameter keys with any value
 * @property {[[number, number], [number, number]]} [bbox]  [[south, west], [north, east]];
 *           optional, e.g. set by an area store for custom areas
 * @property {Object} [boundary]         GeoJSON geometry; optional on the record (the files
 *           provider serves it through getBoundary), set when the area store has it inline
 */

/**
 * @typedef {Object} TimeseriesRequest
 * @property {AreaRecord[]} areas       resolved area records, in response order
 * @property {string[]} parameters       resolved parameter keys
 * @property {string} interval           validated interval id
 * @property {string} [from]             inclusive, interval format
 * @property {string} [to]               inclusive, interval format
 */

/**
 * @typedef {Object} TimeseriesResult
 * @property {string} interval
 * @property {string[]} times            shared time axis, clipped to from..to
 * @property {Object<string, Object<string, (number|null)[]>>} areas
 *           areaId -> parameter key -> values aligned with `times` (null = missing;
 *           a parameter the area has no data for is all nulls)
 */

/**
 * @typedef {Object} LayerRecord        per-area facts of a layer; meaning comes from catalog/layers.js
 * @property {string} id
 * @property {[[number, number], [number, number]]} bounds  [[south, west], [north, east]]
 * @property {string|null} interval      interval id the times are written in (catalog/intervals.js,
 *           e.g. "yearly"), or null for a static layer
 * @property {string[]|null} times       available times, or null for a static layer
 * @property {{urlTemplate: string}|{url: string}} image  "{time}" is replaced by a time
 * @property {{width: number, height: number}|null} grid  size of the value grid, null = no values
 */

/**
 * @typedef {Object} Mosaic
 * @property {string} id
 * @property {string} areaId             "region" or an area id
 * @property {number} zoom               native zoom level
 * @property {[[number, number], [number, number]]} bounds
 * @property {string} image              static website path
 * @property {string|null} labels        static path of the place-name overlay, or null
 */

/**
 * @typedef {Object} DataProvider
 * @property {string} name
 * @property {() => Promise<AreaRecord[]>} listAreas
 * @property {(id: string) => Promise<AreaRecord|null>} getArea
 *           listAreas/getArea are the area store; another store can replace them later
 * @property {(area: AreaRecord) => Promise<Object|null>} getBoundary  GeoJSON geometry
 * @property {() => Promise<string[]>} listParameterKeys        keys with data anywhere
 * @property {(req: TimeseriesRequest) => Promise<TimeseriesResult>} getTimeseries
 * @property {(area: AreaRecord) => Promise<LayerRecord[]>} listLayers
 * @property {(area: AreaRecord, layerId: string, time?: string) => Promise<Object|null>} getLayerValues
 *           the stored integer grid for `time` (a timed layer with time given or a
 *           static layer), or {time: grid} for every time of a timed layer
 *           without `time`; null when the layer has no values
 * @property {() => Promise<{mosaics: Mosaic[]}>} getBasemap
 * @property {() => Promise<string>} dataUpdated                 ISO timestamp
 */

module.exports = {}
