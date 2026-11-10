import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App.jsx';

class Boundary extends React.Component {
  constructor(p) { super(p); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="loadfail">
        <h2>Something in the designer stopped working</h2>
        <p>Your last saved design is still stored in this browser. Reload the page to pick it up. If it fails again, start fresh.</p>
        <p className="mono" style={{ color: 'var(--bone-dim)' }}>{String(this.state.error && this.state.error.message)}</p>
        <button className="btn" onClick={() => { try { localStorage.removeItem('bcs.gd.design'); } catch (e) { /* ignore */ } location.reload(); }}>Start fresh</button>
      </div>
    );
  }
}

createRoot(document.getElementById('root')).render(<Boundary><App /></Boundary>);
