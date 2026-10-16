import { asset } from '../lib/asset'

// Who is behind the project, shown in the nav, About, Contact us and the footer.
// Logo files live in public/logos/ (transparent PNGs, so they work on light and
// dark backgrounds).

export const INSTITUTIONS = [
  { short: 'MNIT Jaipur', name: 'Malaviya National Institute of Technology Jaipur', logo: asset('/logos/mnit-jaipur.png') },
  { short: "St. Stephen's College", name: "St. Stephen's College, University of Delhi", logo: asset('/logos/st-stephens-college.png') },
]

// Team members: { name, role, institution, email }. Empty until the details are
// provided; the Contact Us section shows a short note while it is empty.
export const TEAM = []
