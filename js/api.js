/**
 * Cliente de la API del catálogo (servidor Node + MySQL, ver server/).
 *
 * Si no hay servidor (python -m http.server, doble clic con file://, sin red),
 * `api.online` es false y WebBox OS sigue funcionando con el almacenamiento
 * local del navegador, igual que antes. Nada se rompe.
 *
 * Leer el catálogo es público. Agregar o eliminar exige la clave de
 * administrador (ADMIN_KEY del .env), que se guarda solo en este navegador.
 */
import { storage } from './core/storage.js';

const KEY_NAME = 'serverAdminKey';
const TIMEOUT_MS = 5000;

class ApiClient {
  constructor() {
    this.state = 'unknown'; // 'unknown' | 'online' | 'offline'
    this.store = null; // 'mysql' | 'memory'
    this.items = [];
    this.loadPromise = null;
  }

  get online() {
    return this.state === 'online';
  }

  getKey() {
    return storage.get(KEY_NAME, '') || '';
  }

  hasKey() {
    return this.getKey() !== '';
  }

  setKey(key) {
    const clean = String(key ?? '').trim();
    if (clean) storage.set(KEY_NAME, clean);
    else storage.remove(KEY_NAME);
  }

  clearKey() {
    storage.remove(KEY_NAME);
  }

  /** Nunca lanza: devuelve { ok, status, data }. status 0 = sin conexión. */
  async #request(method, path, { body, auth = false } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const headers = {};
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (auth) headers['X-Admin-Key'] = this.getKey();
      const res = await fetch(path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        cache: 'no-store',
      });
      let data = null;
      if (res.status !== 204) {
        try {
          data = await res.json();
        } catch {
          data = null;
        }
      }
      return { ok: res.ok, status: res.status, data };
    } catch {
      return { ok: false, status: 0, data: null };
    } finally {
      clearTimeout(timer);
    }
  }

  /** ¿Hay un servidor de WebBox OS respondiendo? */
  async check() {
    const r = await this.#request('GET', 'api/health');
    if (r.ok && r.data && r.data.ok === true) {
      this.state = 'online';
      this.store = r.data.store || null;
    } else {
      this.state = 'offline';
      this.store = null;
    }
    return this.online;
  }

  /**
   * Descarga todo el catálogo en UNA petición compartida por las tres
   * pantallas. Devuelve la lista, o null si no hay servidor.
   */
  loadAll(force = false) {
    if (!this.loadPromise || force) {
      this.loadPromise = (async () => {
        if (!(await this.check())) {
          this.items = [];
          return null;
        }
        const r = await this.#request('GET', 'api/items');
        if (!r.ok || !r.data || !Array.isArray(r.data.items)) {
          this.state = 'offline';
          this.items = [];
          return null;
        }
        this.items = r.data.items;
        return this.items;
      })();
    }
    return this.loadPromise;
  }

  /** Cantidad de elementos por tipo (según la última descarga). */
  counts() {
    const out = { youtube: 0, music: 0, movies: 0 };
    for (const item of this.items) {
      if (item.kind in out) out[item.kind] += 1;
    }
    return out;
  }

  /** @returns {Promise<{ok:true,item:object}|{ok:false,status:number,error?:string}>} */
  async create(item) {
    if (!this.hasKey()) return { ok: false, status: 401, error: 'Falta la clave de administrador.' };
    const r = await this.#request('POST', 'api/items', { body: item, auth: true });
    if (r.ok && r.data && r.data.item) return { ok: true, item: r.data.item };
    return { ok: false, status: r.status, error: r.data && r.data.error };
  }

  async remove(serverId) {
    if (!this.hasKey()) return { ok: false, status: 401, error: 'Falta la clave de administrador.' };
    const r = await this.#request('DELETE', `api/items/${encodeURIComponent(serverId)}`, { auth: true });
    return { ok: r.ok, status: r.status, error: r.data && r.data.error };
  }

  /** ¿La clave guardada es la correcta? */
  async checkKey() {
    if (!this.hasKey()) return false;
    const r = await this.#request('GET', 'api/auth', { auth: true });
    return r.ok;
  }
}

export const api = new ApiClient();
