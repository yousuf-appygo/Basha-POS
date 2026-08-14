/**
 * Clean Architecture - Admin Use Cases
 * Handles system administration, backup exports, data restoration, and user management
 */

export class AdminUseCases {
  constructor(repository) {
    this.repository = repository;
  }

  async exportFullBackup() {
    return await this.repository.getFullDatabaseExport();
  }

  async importFullBackup(backupData) {
    if (!backupData || typeof backupData !== "object") {
      throw new Error("Invalid backup format: Expected a valid JSON object");
    }
    const imported = backupData.database || backupData;
    if (!Array.isArray(imported.users) || !Array.isArray(imported.branches)) {
      throw new Error("Invalid backup format: Missing required 'users' or 'branches' arrays");
    }
    return await this.repository.restoreFullDatabase(imported);
  }
}
