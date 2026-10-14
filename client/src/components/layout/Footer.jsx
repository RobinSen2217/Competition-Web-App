// Page footer: project blurb, quick links to the main sections and credits.
export default function Footer() {
  return (
    <footer>
      <div>
        <b>Vegetation of the City</b>A satellite-based look at vegetation and climate trends, built for anyone to explore.
      </div>
      <div>
        <b>Explore</b>
        <a href="#home">Home and city picker</a>
        <a href="#plot">Plot builder</a>
        <a href="#why">Why it changes</a>
        <a href="#outlook">Outlook</a>
      </div>
      <div>
        <b>Project</b>
        <a href="#intro">Introduction</a>
        <a href="#science">The science</a>
        <a href="#methods">Methods</a>
        <a href="#sources">Data sources</a>
        <a href="#faq">FAQ</a>
      </div>
      <div>
        <b>Note</b>© 2026. Data shown is for general information. Imagery © Esri, Maxar, Earthstar Geographics.
      </div>
    </footer>
  )
}
