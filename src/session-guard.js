// All identities are resolved here, never from renderer/request user objects.
const actorPositions = {
  changePassword: 2, createCustomer: 1, updateCustomer: 2, archiveCustomer: 1,
  deleteCustomer: 1, createTransaction: 1, updateTransaction: 2, deleteTransaction: 1,
  addCustomerNote: 2, updateSettings: 1, createBackup: 0, restoreBackup: 1,
  createUser: 4, deleteUser: 1, importDriveCredentials: 0, connectDrive: 0,
  disconnectDrive: 0, backupToDrive: 0, listDriveBackups: 0, restoreDriveBackup: 1, switchDriveAccount: 0
};
const adminOnly = new Set([
  'updateCustomer', 'archiveCustomer', 'deleteCustomer', 'updateTransaction',
  'deleteTransaction', 'updateSettings', 'getUsers', 'createUser', 'deleteUser',
  'getAuditLogs', 'getBackups', 'createBackup', 'restoreBackup', 'pickRestoreFile',
  'pickBackupDirectory', 'getDriveStatus', 'importDriveCredentials', 'openDriveSetup',
  'connectDrive', 'disconnectDrive', 'backupToDrive', 'listDriveBackups', 'restoreDriveBackup', 'switchDriveAccount'
]);
class SessionGuard {
  constructor(db) { this.db = db; this.sessions = new Map(); this.locked = false; }
  actor(key) {
    const session = this.sessions.get(key);
    if (session === null) return null;
    if (session) return this.db.getUsers().find(user => user.id === session) || null;
    // Explicit single-user mode remains available when login is disabled.
    if (!this.locked && this.db.getSettings().require_login !== '1') {
      return this.db.getUsers().find(user => user.role === 'Admin') || null;
    }
    return null;
  }
  invalidate() { this.sessions.clear(); this.locked = true; }
  async invoke(name, key, args, callback) {
    if (name === 'authenticate') {
      this.sessions.set(key, null);
      const user = this.db.authenticate(...args);
      if (user) this.sessions.set(key, user.id);
      return user;
    }
    if (name === 'logout') { this.sessions.set(key, null); return { success: true }; }
    const actor = this.actor(key);
    if (name === 'getSession') return actor;
    if (name === 'getSettings' && !actor) return { require_login: '1', business_name: this.db.getSettings().business_name };
    if (!actor) throw new Error('Sign in to continue.');
    if (adminOnly.has(name) && actor.role !== 'Admin') throw new Error('Only an Administrator can perform this action.');
    const trustedArgs = [...args];
    if (Object.hasOwn(actorPositions, name)) trustedArgs[actorPositions[name]] = actor;
    const result = await callback(trustedArgs, actor);
    if (name === 'restoreBackup' || name === 'restoreDriveBackup') this.invalidate();
    if (name === 'changePassword') {
      this.invalidate();
      this.sessions.set(key, actor.id);
    }
    // Preserve this authenticated session when enabling login; other clients must sign in.
    if (name === 'updateSettings') this.sessions.set(key, actor.id);
    return result;
  }
}
module.exports = SessionGuard;
