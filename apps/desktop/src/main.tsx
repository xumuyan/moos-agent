import '@ant-design/v5-patch-for-react-19';
import React from 'react';
import ReactDOM from 'react-dom/client';
// Upstream page base owns reset and product typography.
document.documentElement.dataset.platform = navigator.platform.includes('Mac') ? 'darwin' : 'web';
import App from './App';
import './vendor/dsh/primitives/input-modality';

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
