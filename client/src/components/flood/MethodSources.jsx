import { useHazard } from '../../lib/hazards'
import { Card, CardHead, Kicker, Lede, Swatch } from '../ui'
import { SectionLoader } from '../common/SectionLoader'
import { cx } from '../../styles/classes'
import { useHazardPage } from './context'
import { dateLabel, fmtNum, listJoin, pct, plural, seriesColor, panelCls, panelTitle, CARD_SCROLL } from './format'

/*
  "Method and sources" (#method): where the data and the model come from,
  all from GET /hazards/:hazard: the dataset's description, source datasets
  with citations and DOIs, the notes about the data, and for the forecast
  the notebook it reproduces, the check against the notebook's printed
  numbers, the train / test split, each model's scores (out-of-fold and
  held-out test) and what each model leans on. Nothing loads that the intro
  has not already loaded (the hazard is cached), so this section has data at once.
*/
export default function MethodSources() {
  const { hazard } = useHazardPage()
  const q = useHazard(hazard)
  const d = q.data
  return (
    <Card id="method" style={CARD_SCROLL} aria-labelledby="hzMethT" aria-busy={q.status === 'loading'}>
      <CardHead>
        <Kicker>Method and sources</Kicker>
        <h2 id="hzMethT">Where the numbers come from</h2>
        <Lede>{d?.dataset?.description || 'The data sets behind this page and how the model was built and checked.'}</Lede>
      </CardHead>
      {q.status === 'error' ? (
        <SectionLoader error={q.error} onRetry={q.retry} className="h-[400px]" />
      ) : !d ? (
        <SectionLoader label="Loading the method…" className="h-[600px]" />
      ) : (
        <div className="flex flex-col gap-[18px]">
          {d.forecast && <Model f={d.forecast} />}
          {d.forecast && <ScoreTable f={d.forecast} provides={d.provides?.forecast} />}
          {d.forecast && <Importance f={d.forecast} provides={d.provides?.forecast} />}
          <div className="grid gap-[18px] md:grid-cols-2">
            <Datasets list={d.dataset?.datasets || []} />
            <DataNotes notes={d.dataset?.notes || []} />
          </div>
        </div>
      )}
    </Card>
  )
}

function Model({ f }) {
  const { events } = useHazardPage()
  const name = (id) => events?.find((e) => e.id === id)?.name || id
  const p = f.provenance || {}
  const check = p.notebookCheck
  const env = p.environment || {}
  const split = f.split || {}
  return (
    <div className={panelCls}>
      <h3 className={panelTitle}>The model</h3>
      <p className="text-[15px]">
        {p.notebook ? `Reproduces the team notebook ${p.notebook}. ` : ''}
        It answers “{f.target?.label}” for every day: {f.target?.definition}
      </p>
      {f.classes?.length > 0 && (
        <ul className="flex flex-col gap-1 text-[14px]">
          {f.classes.map((c) => (
            <li key={c.id}>
              <b>{c.label}</b> <span className="font-mono text-[13px] text-muted">({c.rule})</span>: {c.description}
            </li>
          ))}
        </ul>
      )}
      <dl className="grid gap-x-4 gap-y-2 text-[14px] min-[700px]:grid-cols-[max-content_1fr]">
        {split.trainEvents && (
          <>
            <dt className="font-semibold">Trained on</dt>
            <dd>
              {plural(split.trainEvents.length, 'event')} ({plural(f.data?.trainRows ?? 0, 'day')}): {listJoin(split.trainEvents.map(name))}
            </dd>
          </>
        )}
        {split.testEvents && (
          <>
            <dt className="font-semibold">Tested on</dt>
            <dd>
              {plural(split.testEvents.length, 'held-out event')} ({plural(f.data?.testRows ?? 0, 'day')}): {listJoin(split.testEvents.map(name))}
            </dd>
          </>
        )}
        {split.excludedEvents?.map((x) => (
          <div key={x.id} className="contents">
            <dt className="font-semibold">Left out</dt>
            <dd>
              {name(x.id)}: {x.reason}
            </dd>
          </div>
        ))}
        {check?.applicable && (
          <>
            <dt className="font-semibold">Checked</dt>
            <dd>
              {check.matches
                ? `Matches all ${check.compared} numbers the notebook printed (thresholds and scores).`
                : `${check.mismatches?.length || 0} of ${check.compared} numbers differ from the notebook's printout.`}
            </dd>
          </>
        )}
      </dl>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
        {f.modelVersion && <span>Model version {f.modelVersion}</span>}
        {p.generated && <span>Built {dateLabel(p.generated)}</span>}
        {env.scikitLearn && <span>scikit-learn {env.scikitLearn}</span>}
        {f.horizonDays && <span>Horizon {plural(f.horizonDays, 'day')}</span>}
      </p>
    </div>
  )
}

const modelOrder = (f, provides) => (provides?.models?.map((m) => m.id) || Object.keys(f.models)).filter((id) => f.models[id])

function ScoreTable({ f, provides }) {
  const ids = modelOrder(f, provides)
  const th = 'border-b border-line px-2 py-1.5 text-left text-[12.5px] font-semibold text-muted'
  const td = 'border-b border-line px-2 py-1.5 font-mono text-[13.5px] whitespace-nowrap'
  const cols = [
    ['Threshold', (m) => pct(m.threshold)],
    ['Out-of-fold balanced accuracy', (m) => fmtNum(m.oof?.balancedAccuracy)],
    ['Test balanced accuracy', (m) => fmtNum(m.test?.balancedAccuracy)],
    ['Test precision', (m) => pct(m.test?.precision)],
    ['Test recall', (m) => pct(m.test?.recall)],
    ['Test F1', (m) => fmtNum(m.test?.f1)],
    ['Test ROC AUC', (m) => fmtNum(m.test?.rocAuc)],
    ['Test days flagged', (m) => pct(m.test?.predictedPositiveRate)],
  ]
  const any = f.models[ids[0]]
  return (
    <div className={panelCls}>
      <h3 className={panelTitle}>Scores</h3>
      <p id="hzScoreNote" className="text-[13px] text-muted">
        Out-of-fold: the {any?.oof?.rows ?? ''} training days, each scored by the cross-validation model that held its event out
        {any?.oof?.folds ? ` (${plural(any.oof.folds.length, 'fold')} over whole events)` : ''}; the threshold is the one with the best balanced
        accuracy there. Test: the {any?.test?.rows ?? ''} days of the held-out events, scored by the final model. Balanced accuracy 0.5 is a coin toss.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse" aria-describedby="hzScoreNote">
          <thead>
            <tr>
              <th scope="col" className={th}>Model</th>
              {cols.map(([c]) => (
                <th key={c} scope="col" className={th}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ids.map((id, i) => (
              <tr key={id}>
                <th scope="row" className="border-b border-line px-2 py-1.5 text-left text-[14px] font-semibold">
                  <span className="inline-flex items-center gap-2 whitespace-nowrap">
                    <Swatch color={`var(${seriesColor(i)})`} />
                    {f.models[id].label}
                  </span>
                </th>
                {cols.map(([c, get]) => (
                  <td key={c} className={td}>{get(f.models[id])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Top inputs of each model (Random Forest importance, as the API ranks them)
function Importance({ f, provides }) {
  const ids = modelOrder(f, provides).filter((id) => f.models[id].importance?.length)
  if (!ids.length) return null
  return (
    <div className={panelCls}>
      <h3 className={panelTitle}>What each model leans on</h3>
      <p className="text-[13px] text-muted">The five inputs with the largest share of each model's decisions. Longer bar, more weight.</p>
      <div className={cx('grid gap-x-6 gap-y-4', ids.length > 1 && 'md:grid-cols-2')}>
        {ids.map((id) => {
          const top = f.models[id].importance.slice(0, 5)
          const max = Math.max(...top.map((x) => x.value), 1e-9)
          const color = seriesColor(modelOrder(f, provides).indexOf(id))
          return (
            <section key={id} className="flex flex-col gap-2">
              <h4 className="text-[14px] font-semibold">{f.models[id].label}</h4>
              <ul className="flex flex-col gap-2">
                {top.map((x) => (
                  <li key={x.feature} className="flex flex-col gap-1">
                    <span className="flex justify-between gap-3 text-[14px]">
                      <span className="min-w-0">{x.label || x.feature}</span>
                      <b className="font-mono font-medium">{pct(x.value)}</b>
                    </span>
                    <span className="h-2 w-full overflow-hidden rounded-full bg-line" aria-hidden="true">
                      <span className="block h-full rounded-full" style={{ width: `${(x.value / max) * 100}%`, background: `var(${color})` }} />
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </div>
  )
}

function Datasets({ list }) {
  return (
    <div className={panelCls}>
      <h3 className={panelTitle}>Data sets</h3>
      <ul className="flex flex-col gap-3">
        {list.map((s) => (
          <li key={s.id} className="flex flex-col gap-1">
            <span className="text-[15px] font-semibold">{s.name}</span>
            {s.resolution && <span className="text-[13px] text-muted">{s.resolution}</span>}
            {s.citation && <span className="text-[13px] break-words">{s.citation}</span>}
            {s.url && (
              <a className="self-start text-[13px] break-all" href={s.url} target="_blank" rel="noreferrer">
                {s.doi ? `doi:${s.doi}` : s.url}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

// "Title: text" notes get their title in bold
function DataNotes({ notes }) {
  if (!notes.length) return null
  return (
    <div className={panelCls}>
      <h3 className={panelTitle}>Good to know about the data</h3>
      <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[14px]">
        {notes.map((n) => {
          const m = /^([^:]{3,60}):\s(.+)$/.exec(n)
          return (
            <li key={n}>
              {m ? (
                <>
                  <b>{m[1]}:</b> {m[2]}
                </>
              ) : (
                n
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
