import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      حسابات الموردين — قيد الإنشاء
    </main>
  </StrictMode>,
);
