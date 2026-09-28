const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class BackupManager {
  constructor(dbManager, backupsDir) {
    this.dbManager = dbManager;
    this.backupsDir = backupsDir || path.join(__dirname, '..', '..', 'backups');
    if (!fs.existsSync(this.backupsDir)) {
      fs.mkdirSync(this.backupsDir, { recursive: true });
    }
  }

  getBackupList() {
    if (!fs.existsSync(this.backupsDir)) return [];
    const files = fs.readdirSync(this.backupsDir);
    const backups = [];

    for (const file of files) {
      if (file.endsWith('.db')) {
        const fullPath = path.join(this.backupsDir, file);
        const stats = fs.statSync(fullPath);
        backups.push({
          filename: file,
          filepath: fullPath,
          size: stats.size,
          created_at: stats.mtime.toISOString(),
          formatted_size: (stats.size / 1024).toFixed(1) + ' KB'
        });
      }
    }

    return backups.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  createBackup(customPath = null, user = { id: 1, name: 'Admin' }) {
    // Ensure current DB changes are flushed to disk
    this.dbManager.saveToDisk();

    const now = new Date();
    const dateStr = now.toISOString().replace(/[:.]/g, '-');
    const defaultFilename = `Khata_Backup_${dateStr}_${crypto.randomBytes(4).toString('hex')}.db`;
    const targetPath = customPath || path.join(this.backupsDir, defaultFilename);

    const sourceData = fs.readFileSync(this.dbManager.dbPath);
    fs.writeFileSync(targetPath, sourceData);

    try {
      const settings = this.dbManager.getSettings();
      if (settings.auto_backup_directory && fs.existsSync(settings.auto_backup_directory)) {
        const cloudPath = path.join(settings.auto_backup_directory, path.basename(targetPath));
        fs.copyFileSync(targetPath, cloudPath);
      }
    } catch (err) {
      console.error('Failed to copy backup to cloud directory:', err);
    }

    // Update last_backup_date in settings
    this.dbManager.run(`
      INSERT INTO settings (setting_key, setting_value) VALUES ('last_backup_date', ?)
      ON CONFLICT(setting_key) DO UPDATE SET setting_value = ?
    `, [now.toISOString(), now.toISOString()]);
    this.dbManager.saveToDisk();

    this.dbManager.logAudit('BACKUP', 'SYSTEM', 0, `Created database backup: ${path.basename(targetPath)}`, user);
    this.lastError = null;

    this.onBackupCreated?.({ filename: path.basename(targetPath), filepath: targetPath });

    // Cleanup: keep latest 15 backups, never delete everything
    this.pruneOldBackups(15);

    return {
      success: true,
      filename: path.basename(targetPath),
      filepath: targetPath
    };
  }

  pruneOldBackups(keepCount = 15) {
    try {
      const list = this.getBackupList();
      if (list.length > keepCount) {
        const toDelete = list.slice(keepCount);
        for (const item of toDelete) {
          if (fs.existsSync(item.filepath)) {
            fs.unlinkSync(item.filepath);
          }
        }
      }
    } catch (err) {
      console.warn('Prune backups warning:', err);
    }
  }

  async restoreBackup(backupFilePath, user = { id: 1, name: 'Admin' }) {
    if (user.role && user.role !== 'Admin') throw new Error('Only an Administrator can restore backups.');
    if (!fs.existsSync(backupFilePath)) {
      throw new Error('Backup file does not exist.');
    }

    const backupBuffer = fs.readFileSync(backupFilePath);
    let candidate;
    try {
      candidate = new this.dbManager.SQL.Database(backupBuffer);
      const check = candidate.exec('PRAGMA integrity_check');
      if (check[0]?.values[0]?.[0] !== 'ok') throw new Error('Database integrity check failed.');
      const required = {
        users: ['id', 'name', 'username', 'password_hash', 'role'],
        customers: ['id', 'account_code', 'name', 'currency', 'opening_balance', 'opening_balance_type'],
        transactions: ['id', 'transaction_code', 'customer_id', 'transaction_date', 'transaction_type', 'amount'],
        receipts: ['id', 'receipt_number', 'transaction_id', 'customer_id', 'amount'],
        customer_notes: ['id', 'customer_id', 'note'],
        audit_logs: ['id', 'action', 'description'],
        settings: ['setting_key', 'setting_value'],
        sequences: ['name', 'current_val']
      };
      if (candidate.exec('PRAGMA foreign_key_check').some(result => result.values.length)) throw new Error('Backup contains broken record references.');
      const admins = candidate.exec("SELECT COUNT(*) FROM users WHERE role = 'Admin'");
      if (!admins[0]?.values[0]?.[0]) throw new Error('Backup must contain an administrator.');
      for (const table of Object.keys(required)) {
        const columns = [...new Set([...required[table], ...this.dbManager.query(`PRAGMA table_info(${table})`).map(column => column.name)])];
        candidate.exec(`SELECT ${columns.join(',')} FROM ${table} LIMIT 0`);
      }
    } catch (err) {
      candidate?.close();
      throw new Error('Not a valid Simple Khata backup: ' + err.message);
    }

    // Keep the current database object until the complete restore succeeds.
    const originalDatabase = this.dbManager.db;
    this.dbManager.saveToDisk();
    // Safety step: make a temporary backup of current state before restoring
    const emergencyBackup = path.join(this.backupsDir, `Khata_PreRestore_Backup_${Date.now()}.db`);
    if (fs.existsSync(this.dbManager.dbPath)) {
      fs.copyFileSync(this.dbManager.dbPath, emergencyBackup);
    }

    try {
      this.dbManager.db = candidate;
      this.dbManager.createTables();
      this.dbManager.saveToDisk();

      this.dbManager.logAudit(
        'RESTORE',
        'SYSTEM',
        0,
        `Restored database from backup: ${path.basename(backupFilePath)}`,
        user
      );

      originalDatabase.close();
      return { success: true };
    } catch (err) {
      this.dbManager.db = originalDatabase;
      candidate.close();
      // Revert if failed
      if (fs.existsSync(emergencyBackup)) {
        fs.copyFileSync(emergencyBackup, this.dbManager.dbPath);
      }
      throw err;
    }
  }

  getStatus() {
    const settings = this.dbManager.getSettings();
    const frequency = settings.auto_backup_frequency || 'Daily';
    const latest = this.getBackupList().find(item => !item.filename.startsWith('Khata_PreRestore_'));
    const lastSuccessAt = latest?.created_at || null;
    const hours = { Daily: 24, 'Every 3 Days': 72, Weekly: 168 }[frequency];
    const nextBackupAt = hours && lastSuccessAt ? new Date(Date.parse(lastSuccessAt) + hours * 3600000).toISOString() : null;
    return { frequency, lastSuccessAt, nextBackupAt, overdue: Boolean(hours && (!nextBackupAt || Date.parse(nextBackupAt) <= Date.now())), lastError: this.lastError || null, backupCount: this.getBackupList().length };
  }

  checkAutoBackup() {
    if (this.getStatus().overdue) {
      try {
        return this.createBackup(null, { id: 0, name: 'System Auto-Backup' });
      } catch (err) {
        this.lastError = err.message;
        throw err;
      }
    }
  }

  startScheduler() {
    if (this.scheduler) return;
    this.scheduler = setInterval(() => {
      try { this.checkAutoBackup(); }
      catch (err) { console.error('Automatic backup failed:', err.message); }
    }, 60000);
    this.scheduler.unref();
  }
}

module.exports = BackupManager;
