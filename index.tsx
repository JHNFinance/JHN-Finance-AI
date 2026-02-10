import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

/**
 * Mounts the React application to the DOM element with ID 'root'.
 */
const mountApp = () => {
  const rootElement = document.getElementById('root');
  
  // Diagnostic logs for deployment troubleshooting
  console.log("%c JHN Finance AI Agent Initializing...", "color: #a855f7; font-weight: bold; font-size: 1.2em;");
  console.log("Current URL:", window.location.href);
  console.log("Secure Context (HTTPS):", window.isSecureContext);
  console.log("User Agent:", navigator.userAgent);

  if (!rootElement) {
    console.error("Mounting failed: The element with ID 'root' was not found in the document. Ensure your index.html is correct.");
    return;
  }

  try {
    const root = ReactDOM.createRoot(rootElement);
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
    console.log("React mount successful.");
  } catch (error) {
    console.error("An error occurred during React mounting:", error);
  }
};

// Initialize the app only when the DOM is ready.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountApp);
} else {
  mountApp();
}
