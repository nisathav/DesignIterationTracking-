import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { domainColours } from '../colours';
import { useMeta } from '../hooks';
import { DomainBadge, Loading } from '../components/ui';

interface DomainStats {
  id: number; code: string; name: string; colour: string; ownerName: string | null;
  considerations: number; openConsiderations: number; iterations: number;
  pass: number; conditional: number; fail: number; noVerdict: number;
  openFlagsRaised: number; openFlagsAffecting: number; overdueAffecting: number; escalated: number;
}
interface PersonStats {
  id: number; name: string; role: string; openFlags: number; reviewsToDo: number; overdue: number;
  iterationsAuthored: number; iterationsLast30: number; flagsRaisedOpen: number; considerationsOwnedOpen: number; readyToClose: number;
}
interface DashboardData {
  domains: DomainStats[];
  people: PersonStats[];
  totals: { openFlags: number; overdue: number; escalated: number };
  weeks: Array<{ week: string; iterations: number; flagsRaised: number; flagsClosed: number }>;
}

const OPEN = 'statusBehaviour=open,in_progress';

/** A number that opens the matching list; zero stays quiet. */
function N({ n, to, tone }: { n: number; to: string; tone?: 'bad' | 'esc' }) {
  if (!n) return <span className="dash-zero">0</span>;
  return (
    <Link to={to} className={`dash-num ${tone ?? ''}`}>
      {n}
    </Link>
  );
}

/** Pass / Conditional / Fail as one stacked bar with the counts written out. */
function VerdictBar({ d, max }: { d: DomainStats; max: number }) {
  const total = d.pass + d.conditional + d.fail;
  const parts: Array<[string, number, string]> = [
    ['pass', d.pass, 'Pass'],
    ['cond', d.conditional, 'Conditional'],
    ['fail', d.fail, 'Fail'],
  ];
  return (
    <div className="vbar-wrap">
      <div className="vbar" style={{ width: `${max ? Math.max(4, (total / max) * 100) : 0}%` }} role="img" aria-label={`${d.pass} pass, ${d.conditional} conditional, ${d.fail} fail`}>
        {parts.map(([cls, n, label]) =>
          n ? <span key={cls} className={`vseg ${cls}`} style={{ flexGrow: n }} title={`${label}: ${n}`} /> : null,
        )}
      </div>
      <span className="vbar-text">
        {total ? `${d.pass} / ${d.conditional} / ${d.fail}` : 'no verdicts yet'}
        {d.noVerdict ? <span className="muted"> · {d.noVerdict} pending</span> : null}
      </span>
    </div>
  );
}

/** Small single-series weekly bar chart (8 weeks). */
function WeekBars({ title, values, weeks, to }: { title: string; values: number[]; weeks: string[]; to: string }) {
  const max = Math.max(1, ...values);
  const last = values[values.length - 1];
  return (
    <div className="spark">
      <div className="spark-head">
        <span>{title}</span>
        <Link to={to} className="spark-value">
          {last} <span className="muted small">this week</span>
        </Link>
      </div>
      <div className="spark-bars">
        {values.map((v, i) => (
          <div key={weeks[i]} className="spark-col" title={`Week of ${new Date(`${weeks[i]}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}: ${v}`}>
            <span className={`spark-bar ${i === values.length - 1 ? 'now' : ''}`} style={{ height: `${(v / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="spark-axis muted small">
        <span>8 weeks ago</span>
        <span>this week</span>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const meta = useMeta();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<DashboardData>('/api/dashboard') });
  if (!q.data || !meta.data) return <Loading />;
  const { domains, people, weeks, totals } = q.data;
  const sum = (k: keyof DomainStats) => domains.reduce((n, d) => n + Number(d[k]), 0);
  const { overdue, openFlags, escalated } = totals;
  const maxVerdicts = Math.max(1, ...domains.map((d) => d.pass + d.conditional + d.fail));
  const weekKeys = weeks.map((w) => w.week);
  const lastMonday = weekKeys[weekKeys.length - 1];

  const tiles: Array<[string, number, string, string?]> = [
    ['Open considerations', sum('openConsiderations'), '/considerations?statusBehaviour=open'],
    ['Iterations logged', sum('iterations'), '/iterations'],
    ['Open flags', openFlags, `/flags?${OPEN}`],
    ['Overdue flags', overdue, '/flags?overdue=1', overdue ? 'bad' : undefined],
    ['Escalated', escalated, '/flags?escalated=1', escalated ? 'esc' : undefined],
  ];

  return (
    <div className="dashboard">
      <div className="page-head">
        <h1>Dashboard</h1>
        <p className="muted">Click any number to open the matching list.</p>
      </div>

      <div className="tiles">
        {tiles.map(([label, n, to, tone]) => (
          <Link key={label} to={to} className={`tile ${tone ?? ''}`}>
            <span className="tile-n">{n}</span>
            <span className="tile-l">{label}</span>
          </Link>
        ))}
      </div>

      <section className="panel">
        <header className="panel-head">
          <h2>By domain</h2>
          <span className="legend">
            <span className="lg pass" /> Pass <span className="lg cond" /> Conditional <span className="lg fail" /> Fail
            <span className="muted small"> (iterations by verdict)</span>
          </span>
        </header>
        <div className="table-wrap flat">
          <table className="list dash-table">
            <thead>
              <tr>
                <th>Domain</th>
                <th>Owner</th>
                <th className="num">Considerations (open / all)</th>
                <th className="num">Iterations</th>
                <th className="verdict-col">Verdicts (pass / cond. / fail)</th>
                <th className="num">Open flags raised</th>
                <th className="num">Open flags affecting</th>
                <th className="num">Overdue affecting</th>
                <th className="num">Escalated</th>
              </tr>
            </thead>
            <tbody>
              {domains.map((d) => (
                <tr key={d.id} style={{ boxShadow: `inset 4px 0 0 ${domainColours(d.colour).accent}` }}>
                  <td className="dash-domain">
                    <DomainBadge code={d.code} colour={d.colour} /> {d.name}
                  </td>
                  <td>{d.ownerName ?? <span className="muted">-</span>}</td>
                  <td className="num">
                    <N n={d.openConsiderations} to={`/considerations?domain=${d.id}&statusBehaviour=open`} /> / <N n={d.considerations} to={`/considerations?domain=${d.id}`} />
                  </td>
                  <td className="num">
                    <N n={d.iterations} to={`/iterations?domain=${d.id}`} />
                  </td>
                  <td>
                    <VerdictBar d={d} max={maxVerdicts} />
                  </td>
                  <td className="num">
                    <N n={d.openFlagsRaised} to={`/flags?domain=${d.id}&${OPEN}`} />
                  </td>
                  <td className="num">
                    <N n={d.openFlagsAffecting} to={`/flags?affectedDomain=${d.id}&${OPEN}`} />
                  </td>
                  <td className="num">
                    <N n={d.overdueAffecting} to={`/flags?affectedDomain=${d.id}&overdue=1`} tone="bad" />
                  </td>
                  <td className="num">
                    <N n={d.escalated} to={`/flags?domain=${d.id}&escalated=1`} tone="esc" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>By person</h2>
        </header>
        <div className="table-wrap flat">
          <table className="list dash-table">
            <thead>
              <tr>
                <th>Person</th>
                <th className="num">Open flags assigned</th>
                <th className="num">Reviews to do</th>
                <th className="num">Overdue</th>
                <th className="num">Iterations ready to close</th>
                <th className="num">Iterations (30 days / all)</th>
                <th className="num">Flags raised, still open</th>
                <th className="num">Considerations owned, open</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id}>
                  <td className="nowrap strong">
                    {p.name}
                    {p.role === 'manager' && <span className="muted"> (manager)</span>}
                  </td>
                  <td className="num">
                    <N n={p.openFlags} to={`/flags?assignee=${p.id}&${OPEN}`} />
                  </td>
                  <td className="num">
                    <N n={p.reviewsToDo} to={`/flags?assignee=${p.id}&${OPEN}&type=${meta.lookups('flag_type').find((l) => l.behaviour === 'review')?.id ?? ''}`} />
                  </td>
                  <td className="num">
                    <N n={p.overdue} to={`/flags?assignee=${p.id}&overdue=1`} tone="bad" />
                  </td>
                  <td className="num">{p.readyToClose || <span className="dash-zero">0</span>}</td>
                  <td className="num">
                    <N n={p.iterationsLast30} to={`/iterations?person=${p.id}`} /> / <N n={p.iterationsAuthored} to={`/iterations?person=${p.id}`} />
                  </td>
                  <td className="num">
                    <N n={p.flagsRaisedOpen} to={`/flags?raisedBy=${p.id}&${OPEN}`} />
                  </td>
                  <td className="num">
                    <N n={p.considerationsOwnedOpen} to={`/considerations?owner=${p.id}&statusBehaviour=open`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>Weekly activity</h2>
          <span className="muted small">last 8 weeks, Monday to Sunday</span>
        </header>
        <div className="panel-body sparks">
          <WeekBars title="Iterations logged" values={weeks.map((w) => w.iterations)} weeks={weekKeys} to={`/iterations?from=${lastMonday}`} />
          <WeekBars title="Flags raised" values={weeks.map((w) => w.flagsRaised)} weeks={weekKeys} to={`/flags?from=${lastMonday}`} />
          <WeekBars title="Flags closed" values={weeks.map((w) => w.flagsClosed)} weeks={weekKeys} to={`/flags?statusBehaviour=closed`} />
        </div>
      </section>
    </div>
  );
}
