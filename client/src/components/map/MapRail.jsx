import { FIRST_YEAR, LAST_YEAR } from '../../lib/months'
import { layerDef, layersFor } from '../../lib/map/layers'
import { rangeCls } from '../../styles/classes'
import { Group, GroupTitle, Pill, Pills, Select, Toggle } from '../ui'
import LayerRamp from './LayerRamp'

// Current value at the right of a group title: mono, ink, and without the title's letter-spacing
const VALUE = 'font-mono tracking-[0] text-ink tabular-nums'

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
    <Toggle id={k} checked={show[k]} onChange={(e) => onShow(k, e.target.checked)}> {label}</Toggle>
  )
  return (
    // Scrolls beside the 600px map; at 900px and narrower it sits below and grows freely
    <aside className="flex max-h-[600px] flex-col gap-4 overflow-auto pr-[2px] max-[901px]:max-h-none" aria-label="Map controls">
      <Group>
        <GroupTitle>Layer</GroupTitle>
        <Pills id="layerPills">
          {layersFor(city).map((l) => (
            <Pill key={l.id} data-l={l.id} pressed={l.id === layer} onClick={() => onLayer(l.id)}>
              {l.label}
            </Pill>
          ))}
        </Pills>
      </Group>
      <Group id="yearGrp" hidden={!isYear}>
        <GroupTitle className="flex justify-between">
          Year <b className={VALUE} id="yearOut">{year}</b>
        </GroupTitle>
        <div className="flex flex-nowrap items-center gap-2">
          <button
            type="button"
            className="size-[38px] flex-none cursor-pointer rounded-full border-0 bg-accent text-[14px] text-on-accent"
            id="play"
            aria-label={playing ? 'Pause' : 'Play through the years'}
            onClick={onPlay}
          >
            {playing ? '❚❚' : '▶'}
          </button>
          <input type="range" className={rangeCls} id="year" min={FIRST_YEAR} max={LAST_YEAR} step="1" value={year} aria-label="Year" onChange={(e) => onYear(+e.target.value)} />
        </div>
        <p className="text-[13px] text-muted">Greenest scene of August to October each year (2026: August–September so far).</p>
      </Group>
      <Group>
        <GroupTitle className="flex justify-between">
          Opacity <b className={VALUE} id="opOut">{op}%</b>
        </GroupTitle>
        <input type="range" className={rangeCls} id="op" min="0" max="100" step="5" value={op} aria-label="Layer opacity" onChange={(e) => onOp(+e.target.value)} />
      </Group>
      {/* Greenness compares two years; every other layer compares against the photo */}
      <Group id="cmpGrp" hidden={d.id === 'none'}>
        <Toggle id="swipeOn" checked={swipe} onChange={(e) => onSwipe(e.target.checked)}>
          {' '}
          <span id="swipeLabel">{isYear ? 'Swipe between two years' : 'Swipe against the photo'}</span>
        </Toggle>
        <div className="flex flex-wrap items-center gap-2" id="swipeYears" hidden={!(isYear && swipe)}>
          <Select id="ya" aria-label="Left year" value={ya} onChange={(e) => onYa(+e.target.value)}>
            {YEAR_OPTS.map((y) => <option key={y} value={y}>{y}</option>)}
          </Select>
          <span className="text-[13px] text-muted">left · right</span>
          <Select id="yb" aria-label="Right year" value={yb} onChange={(e) => onYb(+e.target.value)}>
            {YEAR_OPTS.map((y) => <option key={y} value={y}>{y}</option>)}
          </Select>
        </div>
      </Group>
      <LayerRamp ramp={d.ramp} />
      <p className="text-[13px] text-muted" id="layerDesc">{d.desc}</p>
      <Group>
        <GroupTitle>Show</GroupTitle>
        {toggle('labOn', 'Place names')}
        {toggle('allOn', 'Other cities')}
        {toggle('pixOn', 'Sharp pixels')}
      </Group>
      {children}
    </aside>
  )
}
