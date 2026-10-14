// Colour legend of the active data layer: gradient bar, tick values, end captions.
// Renders an empty .ramp for layers without one ("None").
export default function LayerRamp({ ramp }) {
  return (
    <div className="ramp" id="ramp">
      {ramp && (
        <>
          <div className="bar" style={{ background: `linear-gradient(90deg,${ramp.stops.join(',')})` }} />
          <div className="ticks">
            {ramp.ticks.map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>
          <div className="ends">
            <span>{ramp.ends[0]}</span>
            <span>{ramp.ends[1]}</span>
          </div>
        </>
      )}
    </div>
  )
}
