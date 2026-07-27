/**
 * Expose React and ReactDOM on window before the main app loads.
 * This ensures window.React is available when remote code components
 * and the SDK are dynamically imported via the import map.
 */
import * as React from 'react';
import * as ReactDOM from 'react-dom';

window.React = React;
window.ReactDOM = ReactDOM;
