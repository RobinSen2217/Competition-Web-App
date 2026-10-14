import { FIRST_YEAR, LAST_YEAR } from '../../lib/months'
import { layerDef, layersFor } from '../../lib/map/layers'
import LayerRamp from './LayerRamp'

const YEAR_OPTS = Array.from({ length: LAST_YEAR - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i)

/*
  Control rail beside the map: layer pills, year slider + player (greenness
  only), opacity, swipe compare, legend ramp, display toggles and, as children,
  the area planner. Purely presentational; MapExplorer owns the state.
*/
export default function MapRail({
  city, layer, onLayer,
  year, onYear, playing, onPlay,
  op, onOp,
  swipe, onSwipe, ya, yb, onYa, onYb,
  show, onShow,
  children,
}) {
  const d = layerDef(layer), isYear = d.id === 'green'
  const toggle = (k, label) => (
    <label className="toggle">
      <input type="checkbox" id={k} checked={show[k]} onChange={(e) => onShow(k, e.target.checked)} /> {label}
    </label>
  )
  return (
    <aside className="rail" aria-label="Map controls">
      <div className="grp">
        <span className="t">Layer</span>
        <div className="pills" id="layerPills">
          {layersFor(city).map((l) => (
            <button type="button" className="pill" key={l.id} data-l={l.id} aria-pressed={l.id === layer} onClick={() => onLayer(l.id)}>
              {l.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grp" id="yearGrp" hidden={!isYear}>
        <span className="t" style={{ display: 'flex', justifyContent: 'space-between' }}>
          Year <b className="mono" id="yearOut" style={{ color: 'var(--ink)', letterSpacing: 0 }}>{year}</b>
        </span>
        <div className="rowc" style={{ flexWrap: 'nowrap' }}>
          <button type="button" className="playbtn" id="play" aria-label={playing ? 'Pause' : 'Play through the years'} onClick={onPlay}>
            {playing ? '❚❚' : '▶'}
          </button>
          <input type="range" id="year" min={FIRST_YEAR} max={LAST_YEAR} step="1" value={year} aria-label="Year" onChange={(e) => onYear(+e.target.value)} />
        </div>
        <p className="xs muted">Greenest scene of August to October each year (2026: August–September so far).</p>
      </div>
      <div className="grp">
        <span className="t" style={{ display: 'flex', justifyContent: 'space-between' }}>
          Opacity <b className="mono" id="opOut" style={{ color: 'var(--ink)', letterSpacing: 0 }}>{op}%</b>
        </span>
        <input type="range" id="op" min="0" max="100" step="5" value={op} aria-label="Layer opacity" onChange={(e) => onOp(+e.target.value)} />
      </div>
      {/* Greenness compares two years; every other layer compares against the photo */}
      <div className="grp" id="cmpGrp" hidden={d.id === 'none'}>
        <label className="toggle">
          <input type="checkbox" id="swipeOn" checked={swipe} onChange={(e) => onSwipe(e.target.checked)} />{' '}
          <span id="swipeLabel">{isYear ? 'Swipe between two years' : 'Swipe against the photo'}</span>
        </label>
        <div className="rowc" id="swipeYears" hidden={!(isYear && swipe)}>
          <select id="ya" aria-label="Left year" value={ya} onChange={(e) => onYa(+e.target.value)}>
            {YEAR_OPTS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <span className="muted xs">left · right</span>
          <select id="yb" aria-label="Right year" value={yb} onChange={(e) => onYb(+e.target.value)}>
            {YEAR_OPTS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>
      <LayerRamp ramp={d.ramp} />
      <p className="xs muted" id="layerDesc">{d.desc}</p>
      <div className="grp">
        <span className="t">Show</span>
        {toggle('labOn', 'Place names')}
        {toggle('allOn', 'Other cities')}
        {toggle('pixOn', 'Sharp pixels')}
      </div>
      {children}
    </aside>
  )
}
