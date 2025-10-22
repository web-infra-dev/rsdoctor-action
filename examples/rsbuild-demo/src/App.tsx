import './App.css';

const App = () => {
  const handleClick = () => {
    console.log('Button clicked!');
    alert('Hello from Rsbuild!');
  };

  return (
    <div className="content">
      <h1>Rsbuild with React</h1>
      <p>Start building amazing things with Rsbuild.</p>
      
      <div className="button-container">
        <button onClick={handleClick} className="primary-button">
          Click Me!
        </button>
        <button onClick={() => console.log('Secondary button')} className="secondary-button">
          Secondary Action
        </button>
      </div>
      
      <div className="info-section">
        <div className="feature-card">
          <h3>Fast Build</h3>
          <p>Rsbuild provides lightning-fast build times with modern tooling.</p>
        </div>
        <div className="feature-card">
          <h3>TypeScript Support</h3>
          <p>Built-in TypeScript support with excellent developer experience.</p>
        </div>
        <div className="feature-card">
          <h3>Modern React</h3>
          <p>Full support for React 18+ with concurrent features.</p>
        </div>
      </div>
      
      <div className="stats-container">
        <div className="stat-item">
          <span className="stat-number">100%</span>
          <span className="stat-label">TypeScript</span>
        </div>
        <div className="stat-item">
          <span className="stat-number">Fast</span>
          <span className="stat-label">Build Speed</span>
        </div>
        <div className="stat-item">
          <span className="stat-number">Modern</span>
          <span className="stat-label">Tooling</span>
        </div>
      </div>
    </div>
  );
};

export default App;
