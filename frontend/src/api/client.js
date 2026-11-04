import axios from 'axios';

const TOKEN_KEY = 'token';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use((config) => {
  const token = tokenStore.get();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && !err.config.url.endsWith('/auth/login')) {
      tokenStore.clear();
      window.dispatchEvent(new Event('auth:logout'));
    }
    return Promise.reject(err);
  },
);

export function errorMessage(err) {
  return err.response?.data?.message || err.message || 'Something went wrong';
}

// { fieldName: 'message' } from a 400 validation response.
export function fieldErrors(err) {
  const list = err.response?.data?.errors || [];
  return Object.fromEntries(list.map((e) => [e.field, e.message]));
}

export default api;
