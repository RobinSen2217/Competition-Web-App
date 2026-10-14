// Colour legend of the active data layer: gradient bar, tick values, end captions.
// Renders an empty column for layers without one ("None").
export default function LayerRamp({ ramp }) {
  return (
    <div className="flex flex-col gap-1" id="ramp">
      {ramp && (
        <>
          <div className="h-3 rounded-full" style={{ background: `linear-gradient(90deg,${ramp.stops.join(',')})` }} />
          {/* leading-[normal]: the original used the `font:` shorthand here */}
          <div className="flex justify-between font-mono text-[12px] leading-[normal] font-normal text-muted">
            {ramp.ticks.map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>
          <div className="flex justify-between text-[12.5px] text-muted">
            <span>{ramp.ends[0]}</span>
            <span>{ramp.ends[1]}</span>
          </div>
        </>
      )}
    </div>
  )
}
