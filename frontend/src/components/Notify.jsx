import { createContext, useCallback, useContext, useState } from 'react';
import { Alert, Snackbar } from '@mui/material';

const NotifyContext = createContext(() => {});

export function NotifyProvider({ children }) {
  const [msg, setMsg] = useState(null);

  const notify = useCallback((text, severity = 'success') => setMsg({ text, severity, key: Date.now() }), []);

  return (
    <NotifyContext.Provider value={notify}>
      {children}
      <Snackbar
        key={msg?.key}
        open={!!msg}
        autoHideDuration={4000}
        onClose={() => setMsg(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        {msg ? (
          <Alert severity={msg.severity} variant="filled" onClose={() => setMsg(null)}>
            {msg.text}
          </Alert>
        ) : undefined}
      </Snackbar>
    </NotifyContext.Provider>
  );
}

export function useNotify() {
  return useContext(NotifyContext);
}
