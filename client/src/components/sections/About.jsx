import { INSTITUTIONS } from '../../data/contact'
import { Card, CardHead, Kicker } from '../ui'

// About: why a city's vegetation matters, what the project does and who runs it.
export default function About() {
  return (
    <Card id="about" aria-labelledby="aboutT">
      <CardHead>
        <Kicker>About the project</Kicker>
        <h2 id="aboutT">Why watch a city's vegetation?</h2>
      </CardHead>
      {/* Two columns side by side when there is room (each at least 320px), else stacked */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-[22px]">
        <p>Green cover cools streets, holds soil and water, filters dust and supports crops on a city's edge. When it thins, people feel it as hotter nights, dustier air and stressed water supplies. Rising temperatures, fast urban growth, irregular rain and falling groundwater all act on it at once.</p>
        <p>This project combines free Earth-observation data from NASA, ESA and ISRO missions with physical indicators of heat, water and surface energy. The aim is a tool that shows how vegetation is changing in any chosen area, explains the main causes, and forecasts it a few months ahead for residents, planners, farmers, researchers and students.</p>
      </div>
      <p className="text-[14px] text-muted">
        A joint project of {INSTITUTIONS.map((i) => i.name).join(' and ')}.
      </p>
    </Card>
  )
}
