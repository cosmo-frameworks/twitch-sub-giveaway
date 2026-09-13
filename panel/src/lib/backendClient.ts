import axios, { type AxiosInstance } from 'axios'

/**
 * Cliente HTTP contra el backend del sorteo.
 *
 * En desarrollo Vite hace de proxy de `/api` al puerto 3000; en producción el
 * propio backend sirve este panel, así que la ruta relativa vale en ambos casos.
 */
export class BackendClient {
  private readonly _client: AxiosInstance

  constructor() {
    this._client = axios.create({
      baseURL: import.meta.env.VITE_BACKEND_URL ?? '',
      headers: { 'Content-Type': 'application/json' },
      timeout: 10_000,
    })
  }

  async get<T>(url: string): Promise<{ data: T }> {
    return await this._client.get<T>(url)
  }

  async post<T>(url: string, body?: unknown): Promise<{ data: T }> {
    return await this._client.post<T>(url, body)
  }

  async put<T>(url: string, body?: unknown): Promise<{ data: T }> {
    return await this._client.put<T>(url, body)
  }

  async delete<T>(url: string): Promise<{ data: T }> {
    return await this._client.delete<T>(url)
  }
}
