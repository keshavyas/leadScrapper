import React, { useState, useRef, useEffect } from 'react';

const CATEGORIES = ['Doctor Clinic', 'Fashion Designer', 'Coaching Institute', 'Gym', 'Salon', 'Restaurant', 'Interior Designer', 'Dentist'];
const STAGES = [
  'Launching browser engine',
  'Opening Google Maps',
  'Scrolling the results list',
  'Parsing sidebar data',
  'Removing duplicates',
  'Building your CSV',
];
const SAMPLE = [
  ['Business name', 'Category', '+91 00000 00000', 'example.com'],
  ['Business name', 'Category', '+91 00000 00000', 'example.com'],
  ['Business name', 'Category', '—', '—'],
];

export default function App() {
  const [category, setCategory] = useState('Doctor Clinic');
  const [area, setArea] = useState('Vijay Nagar');
  const [city, setCity] = useState('Indore');
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null); // lead count string
  const timer = useRef(null);

  useEffect(() => () => clearInterval(timer.current), []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (loading) return;
    setError('');
    setDone(null);
    setLoading(true);
    setStage(0);
    timer.current = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 9000);

    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessType: category, area, city }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Server error (${res.status})`);
      }

      const reader = res.body.getReader();
      const chunks = [];
      for (;;) {
        const { done: end, value } = await reader.read();
        if (end) break;
        chunks.push(value);
      }

      const url = URL.createObjectURL(new Blob(chunks, { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${category}-${area}-${city}.csv`.replace(/\s+/g, '_').toLowerCase();
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setDone(res.headers.get('X-Lead-Count') || '');
    } catch (err) {
      setError(err.message);
    } finally {
      clearInterval(timer.current);
      setLoading(false);
    }
  }

  const status = loading ? 'run' : done !== null ? 'ok' : '';
  const label = loading ? 'Running' : done !== null ? 'Complete' : 'Ready';

  return (
    <>
      <header className="top">
        <div className="top-in">
          <div className="brand"><span className="logo" />LeadScout</div>
          <div className="tag"><span className="dot" />Runs locally on your machine</div>
        </div>
      </header>

      <main className="wrap">
        <div className="head">
          <h1>Build a local business lead list</h1>
          <p>Choose a category and an area. LeadScout searches Google Maps in a headless browser and downloads the results as a CSV file.</p>
        </div>

        <div className="grid">
          <form className="panel" onSubmit={handleSubmit}>
            <h2>Search parameters</h2>

            <label htmlFor="cat" style={{ marginTop: 0 }}>Business category</label>
            <input id="cat" value={category} onChange={(e) => setCategory(e.target.value)} required />
            <div className="chips">
              {CATEGORIES.map((c) => (
                <button type="button" key={c} className={`chip ${category === c ? 'on' : ''}`} aria-pressed={category === c} onClick={() => setCategory(c)}>{c}</button>
              ))}
            </div>

            <div className="row">
              <div>
                <label htmlFor="area">Area or neighbourhood</label>
                <input id="area" value={area} onChange={(e) => setArea(e.target.value)} required />
              </div>
              <div>
                <label htmlFor="city">City</label>
                <input id="city" value={city} onChange={(e) => setCity(e.target.value)} required />
              </div>
            </div>

            <button className="go" disabled={loading}>{loading ? 'Collecting leads…' : 'Collect leads'}</button>
            {error && <div className="alert" role="alert">{error}</div>}
            <p className="fine">A run takes 1–2 minutes. Respect Google's terms and local data-protection rules when contacting leads.</p>
          </form>

          <section className="panel" aria-live="polite">
            <div className="ph">
              <h2>{loading || done !== null ? 'Run progress' : 'Output preview'}</h2>
              <span className={`badge ${status}`}>{label}</span>
            </div>

            {loading && (
              <ol className="steps">
                {STAGES.map((s, i) => (
                  <li key={s} className={i < stage ? 'done' : i === stage ? 'act' : ''}><span className="mk" />{s}</li>
                ))}
              </ol>
            )}

            {!loading && done !== null && (
              <div className="result">{done ? `${done} leads` : 'Leads'} exported. Your CSV is in your downloads folder.</div>
            )}

            {!loading && done === null && (
              <>
                <div className="tw">
                  <table>
                    <thead><tr><th>Business name</th><th>Category</th><th>Phone</th><th>Website</th></tr></thead>
                    <tbody>{SAMPLE.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="sk">{c}</td>)}</tr>)}</tbody>
                  </table>
                </div>
                <p className="note">Your CSV will contain these four columns. Duplicate businesses are removed automatically.</p>
              </>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
