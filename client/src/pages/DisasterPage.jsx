// The disaster module ("/disaster"). Intentionally empty for now: the content
// will go inside <main>, using the same page column as the vegetation page.
export default function DisasterPage() {
  return (
    <main className="mx-auto flex max-w-[1180px] flex-col gap-7 px-5 pt-7 pb-16">
      {/* Visually hidden heading so the page still has a title for screen readers */}
      <h1 className="sr-only">Disaster</h1>
    </main>
  )
}
