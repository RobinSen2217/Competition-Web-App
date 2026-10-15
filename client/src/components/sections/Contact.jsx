import { INSTITUTIONS, TEAM } from '../../data/contact'
import { Card, CardHead, Kicker, Note } from '../ui'

// Contact Us: the partner institutions and the team. Edit src/data/contact.js
// to change what is shown here.
export default function Contact() {
  return (
    <Card id="contact" aria-labelledby="contactT">
      <CardHead>
        <Kicker>Contact us</Kicker>
        <h2 id="contactT">Who is behind this project</h2>
      </CardHead>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-3">
        {INSTITUTIONS.map((i) => (
          <div key={i.short} className="flex flex-col gap-1 rounded-2xl bg-surface2 p-4">
            {i.logo && <img src={i.logo} alt="" className="mb-1 h-12 w-auto self-start" />}
            <b className="font-display text-[19px] font-semibold">{i.short}</b>
            <span className="text-[14px] text-muted">{i.name}</span>
          </div>
        ))}
      </div>
      {TEAM.length ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-3">
          {TEAM.map((m) => (
            <div key={m.email || m.name} className="flex flex-col gap-0.5 rounded-2xl border border-line p-4">
              <b>{m.name}</b>
              {m.role && <span className="text-[14px] text-muted">{m.role}</span>}
              {m.institution && <span className="text-[14px] text-muted">{m.institution}</span>}
              {m.email && (
                <a className="mt-1 text-[14px] break-all" href={`mailto:${m.email}`}>
                  {m.email}
                </a>
              )}
            </div>
          ))}
        </div>
      ) : (
        <Note>Team contact details will be added here soon.</Note>
      )}
    </Card>
  )
}
