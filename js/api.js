/**
 * Cliente de la API del catálogo (servidor Node + MySQL, ver server/).
 *
 * Si no hay servidor (python -m http.server, doble clic con file://, sin red),
 * `api.online` es false y WebBox OS sigue funcionando con el almacenamiento
 * local del navegador, igual que antes. Nada se rompe.
 *
 * Cuentas: con el servidor en marcha se inicia sesión con usuario y contraseña.
 * El token de sesión se guarda solo en este navegador. El administrador agrega y
 * elimina contenido y gestiona usuarios; el usuario normal solo ve y reproduce.
 */
import { storage } from './core/storage.js';

const TOKEN_KEY = 'authToken';
const TIMEOUT_MS = 5000;

class ApiClient {
  constructor() {
    this.state = 'unknown'; // 'unknown' | 'online' | 'offline'
    this.store = null; // 'mysql' | 'memory'
    this.items = [];
    this.loadPromise = null;
    this.loginRequired = false; // el servidor exige iniciar sesión
    this.registerAllowed = false; // el servidor permite crear cuentas desde la pantalla de acceso
    this.user = null; // { id, username, role } de la sesión actual
  }

  get online() {
    return this.state === 'online';
  }

  getToken() {
    return storage.get(TOKEN_KEY, '') || '';
  }

  #setToken(token) {
    if (token) storage.set(TOKEN_KEY, token);
    else storage.remove(TOKEN_KEY);
  }

  /** ¿Hay que mostrar la pantalla de acceso? (servidor en marcha, exige login y no hay sesión) */
  get needsLogin() {
    return this.online && this.loginRequired && !this.user;
  }

  get isAdmin() {
    return this.online && this.user?.role === 'admin';
  }

  /**
   * ¿Puede agregar/eliminar contenido? Sin servidor (modo local) o con acceso abierto sí,
   * como siempre; con inicio de sesión obligatorio, solo el administrador.
   */
  get canEdit() {
    return !this.online || !this.loginRequired || this.isAdmin;
  }

  /** Compatibilidad: "tener la clave" ahora significa ser administrador con sesión iniciada. */
  hasKey() {
    return this.isAdmin;
  }

  /** Nunca lanza: devuelve { ok, status, data }. status 0 = sin conexión. */
  async #request(method, path, { body, auth = false } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const headers = {};
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const token = this.getToken();
      if (auth && token) headers.Authorization = `Bearer ${token}`;
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
      this.loginRequired = r.data.login === true;
      this.registerAllowed = r.data.register === true;
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
        await this.restoreSession();
        const r = await this.#request('GET', 'api/items', { auth: true });
        if (r.status === 401) {
          // Servidor en marcha pero hace falta iniciar sesión: no es "sin conexión".
          this.items = [];
          return null;
        }
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
    const out = { youtube: 0, music: 0, movies: 0, series: 0 };
    for (const item of this.items) {
      if (item.kind in out) out[item.kind] += 1;
    }
    return out;
  }

  /** @returns {Promise<{ok:true,item:object}|{ok:false,status:number,error?:string}>} */
  async create(item) {
    if (!this.isAdmin) return { ok: false, status: 403, error: 'Solo el administrador puede agregar contenido.' };
    const r = await this.#request('POST', 'api/items', { body: item, auth: true });
    if (r.ok && r.data && r.data.item) return { ok: true, item: r.data.item };
    return { ok: false, status: r.status, error: r.data && r.data.error };
  }

  async remove(serverId) {
    if (!this.isAdmin) return { ok: false, status: 403, error: 'Solo el administrador puede eliminar contenido.' };
    const r = await this.#request('DELETE', `api/items/${encodeURIComponent(serverId)}`, { auth: true });
    return { ok: r.ok, status: r.status, error: r.data && r.data.error };
  }

  // --------------------------------------------------------------- cuentas

  /** Recupera la sesión guardada (si el token sigue valiendo). Nunca lanza. */
  async restoreSession() {
    if (!this.online || this.user || !this.getToken()) return this.user;
    const r = await this.#request('GET', 'api/me', { auth: true });
    if (r.ok && r.data?.user) this.user = r.data.user;
    else if (r.status === 401) this.#setToken('');
    return this.user;
  }

  /** @returns {Promise<{ok:true,user:object}|{ok:false,status:number,error:string}>} */
  async login(username, password) {
    return this.#startSession('api/login', { username, password });
  }

  async register(username, password) {
    return this.#startSession('api/register', { username, password });
  }

  async #startSession(path, body) {
    if (!this.online && !(await this.check())) return { ok: false, status: 0, error: 'No hay conexión con el servidor.' };
    const r = await this.#request('POST', path, { body });
    if (r.ok && r.data?.token && r.data?.user) {
      this.#setToken(r.data.token);
      this.user = r.data.user;
      return { ok: true, user: this.user };
    }
    return { ok: false, status: r.status, error: r.data?.error || 'No se pudo iniciar sesión.' };
  }

  /** Cierra la sesión en este navegador. */
  logout() {
    this.#setToken('');
    this.user = null;
    this.items = [];
    this.loadPromise = null;
  }

  async changePassword(current, password) {
    const r = await this.#request('POST', 'api/me/password', { body: { current, password }, auth: true });
    if (r.ok && r.data?.token) {
      this.#setToken(r.data.token);
      return { ok: true };
    }
    return { ok: false, status: r.status, error: r.data?.error || 'No se pudo cambiar la contraseña.' };
  }

  async listUsers() {
    const r = await this.#request('GET', 'api/users', { auth: true });
    return r.ok && Array.isArray(r.data?.users)
      ? { ok: true, users: r.data.users }
      : { ok: false, status: r.status, error: r.data?.error || 'No se pudo leer la lista.' };
  }

  async createUser(username, password, role) {
    const r = await this.#request('POST', 'api/users', { body: { username, password, role }, auth: true });
    return r.ok ? { ok: true, user: r.data?.user } : { ok: false, status: r.status, error: r.data?.error || 'No se pudo crear el usuario.' };
  }

  async deleteUser(id) {
    const r = await this.#request('DELETE', `api/users/${encodeURIComponent(id)}`, { auth: true });
    return { ok: r.ok, status: r.status, error: r.data?.error };
  }

  async resetPassword(id, password) {
    const r = await this.#request('POST', `api/users/${encodeURIComponent(id)}/password`, { body: { password }, auth: true });
    return { ok: r.ok, status: r.status, error: r.data?.error };
  }
}

export const api = new ApiClient();
