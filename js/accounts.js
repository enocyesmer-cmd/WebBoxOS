/**
 * Pantallas de cuentas: iniciar sesión, crear cuenta, cambiar contraseña y gestión de
 * usuarios (solo administrador). Usa el cuadro de diálogo común, así que se maneja con
 * mando, teclado y mouse.
 */
import { api } from './api.js';
import { toast } from './ui.js';

const ROLE_LABEL = { admin: 'Administrador', user: 'Usuario' };
export const roleLabel = (role) => ROLE_LABEL[role] ?? role;

export class Accounts {
  /** @param {{dialog:import('./dialog.js').Dialog, onSessionChange:(kind:'login'|'logout'|'password')=>void,
   *   onUsersChanged?:()=>void}} opts */
  constructor({ dialog, onSessionChange, onUsersChanged }) {
    this.dialog = dialog;
    this.onSessionChange = onSessionChange;
    this.onUsersChanged = onUsersChanged ?? (() => {});
  }

  /** Pantalla de acceso: no se puede cerrar hasta entrar. */
  showLogin() {
    this.dialog.open({
      title: 'Iniciar sesión',
      hint: 'Entra con tu usuario y contraseña de WebBox OS.',
      locked: true,
      fields: [
        { key: 'username', label: 'Usuario', placeholder: 'tu usuario' },
        { key: 'password', label: 'Contraseña', type: 'password', placeholder: '••••••' },
      ],
      submitLabel: 'Entrar',
      secondary: api.registerAllowed ? { label: 'Crear cuenta', run: () => this.showRegister() } : undefined,
      onSubmit: async (v) => {
        if (!v.username || !v.password) return 'Escribe tu usuario y tu contraseña.';
        const r = await api.login(v.username, v.password);
        if (!r.ok) return r.error;
        toast(`Hola, ${r.user.username}`);
        this.onSessionChange('login');
        return null;
      },
    });
  }

  showRegister() {
    this.dialog.open({
      title: 'Crear cuenta',
      hint: 'Usuario de 3 a 32 caracteres (letras, números, punto, guion). Contraseña de al menos 6.',
      locked: true,
      fields: [
        { key: 'username', label: 'Usuario' },
        { key: 'password', label: 'Contraseña', type: 'password' },
        { key: 'again', label: 'Repite la contraseña', type: 'password' },
      ],
      submitLabel: 'Crear cuenta',
      secondary: { label: 'Ya tengo cuenta', run: () => this.showLogin() },
      onSubmit: async (v) => {
        if (v.password !== v.again) return 'Las contraseñas no coinciden.';
        const r = await api.register(v.username, v.password);
        if (!r.ok) return r.error;
        toast(`Cuenta creada. Hola, ${r.user.username}`);
        this.onSessionChange('login');
        return null;
      },
    });
  }

  logout() {
    api.logout();
    toast('Sesión cerrada');
    this.onSessionChange('logout');
    if (api.needsLogin) this.showLogin();
  }

  changePassword() {
    this.dialog.open({
      title: 'Cambiar contraseña',
      hint: 'Mínimo 6 caracteres. Las demás sesiones de tu cuenta se cerrarán.',
      fields: [
        { key: 'current', label: 'Contraseña actual', type: 'password' },
        { key: 'password', label: 'Contraseña nueva', type: 'password' },
        { key: 'again', label: 'Repite la nueva', type: 'password' },
      ],
      submitLabel: 'Cambiar',
      onSubmit: async (v) => {
        if (!v.current) return 'Escribe tu contraseña actual.';
        if (v.password !== v.again) return 'Las contraseñas nuevas no coinciden.';
        const r = await api.changePassword(v.current, v.password);
        if (!r.ok) return r.error;
        toast('Contraseña cambiada');
        this.onSessionChange('password');
        return null;
      },
    });
  }

  // ------------------------------------------------- solo administrador

  createUser() {
    this.dialog.open({
      title: 'Crear usuario',
      hint: 'En "Rol" escribe "usuario" (solo ve y reproduce) o "admin" (agrega contenido y gestiona usuarios).',
      fields: [
        { key: 'username', label: 'Usuario' },
        { key: 'password', label: 'Contraseña (mínimo 6)', type: 'password' },
        { key: 'role', label: 'Rol', value: 'usuario', placeholder: 'usuario o admin' },
      ],
      submitLabel: 'Crear',
      onSubmit: async (v) => {
        const word = v.role.toLowerCase();
        let role = 'user';
        if (['admin', 'administrador'].includes(word)) role = 'admin';
        else if (word && !['usuario', 'user'].includes(word)) return 'El rol debe ser "usuario" o "admin".';
        const r = await api.createUser(v.username, v.password, role);
        if (!r.ok) return r.error;
        toast(`Usuario creado: ${r.user?.username ?? v.username}`);
        this.onUsersChanged();
        return null;
      },
    });
  }

  /** Restablecer la contraseña de un usuario o eliminarlo. */
  manageUser(user) {
    this.dialog.open({
      title: `${user.username} · ${roleLabel(user.role)}`,
      hint: 'Escribe una contraseña nueva para restablecerla, o elimina la cuenta.',
      fields: [{ key: 'password', label: 'Contraseña nueva (mínimo 6)', type: 'password' }],
      submitLabel: 'Restablecer contraseña',
      secondary: { label: 'Eliminar usuario', run: () => this.#confirmDelete(user) },
      onSubmit: async (v) => {
        if (!v.password) return 'Escribe la contraseña nueva.';
        const r = await api.resetPassword(user.id, v.password);
        if (!r.ok) return r.error || 'No se pudo restablecer.';
        toast(`Contraseña restablecida: ${user.username}`);
        return null;
      },
    });
  }

  #confirmDelete(user) {
    this.dialog.open({
      title: `¿Eliminar a ${user.username}?`,
      hint: 'Se borra su cuenta y su sesión deja de valer al instante. No se puede deshacer.',
      fields: [],
      submitLabel: 'Sí, eliminar',
      secondary: { label: 'No, volver', run: () => this.manageUser(user) },
      onSubmit: async () => {
        const r = await api.deleteUser(user.id);
        if (!r.ok) return r.error || 'No se pudo eliminar.';
        toast(`Usuario eliminado: ${user.username}`);
        this.onUsersChanged();
        return null;
      },
    });
  }
}
