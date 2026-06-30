import axios, { AxiosError } from "axios";

export const brokerHttp = axios.create({ timeout: 8000 });

export interface BrokerError {
  type: "TIMEOUT" | "NETWORK_OFFLINE" | "AUTH_FAILURE" | "RATE_LIMITED" | "REJECTED" | "UNKNOWN";
  message: string;
  originalError?: any;
}

export function normalizeBrokerHttpError(err: unknown): BrokerError {
  if (axios.isAxiosError(err)) {
    const code = err.code;
    const status = err.response?.status;
    
    if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') {
      return { type: "TIMEOUT", message: err.message, originalError: err };
    }
    if (code === 'ECONNREFUSED' || code === 'ENOTFOUND') {
      return { type: "NETWORK_OFFLINE", message: err.message, originalError: err };
    }
    if (status === 401 || status === 403) {
      return { type: "AUTH_FAILURE", message: err.message, originalError: err };
    }
    if (status === 429) {
      return { type: "RATE_LIMITED", message: err.message, originalError: err };
    }
    if (status && status >= 400 && status < 500) {
      return { type: "REJECTED", message: err.message, originalError: err };
    }
    return { type: "UNKNOWN", message: err.message, originalError: err };
  }
  return { type: "UNKNOWN", message: String(err), originalError: err };
}
