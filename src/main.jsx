// main.jsx - Application entry point
const { StrictMode } = React;
const { createRoot } = ReactDOM;

// Wait for App to be loaded, then render
if (window.App) {
  createRoot(document.getElementById('root')).render(
    React.createElement(StrictMode, null,
      React.createElement(window.App)
    )
  );
} else {
  // If App isn't loaded yet, wait for it
  window.addEventListener('load', () => {
    createRoot(document.getElementById('root')).render(
      React.createElement(StrictMode, null,
        React.createElement(window.App)
      )
    );
  });
}
