import axios from 'axios';
import { RELAYER_URL } from './constants';

export const apiClient = axios.create({
  baseURL: RELAYER_URL,
  timeout: 30_000,
});

apiClient.interceptors.response.use(
  r => r,
  err => {
    const message =
      err.response?.data?.error ?? err.message ?? 'Unknown error';
    return Promise.reject(new Error(message));
  }
);
