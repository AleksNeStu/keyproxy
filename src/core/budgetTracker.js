const fs = require('fs');
const path = require('path');

/**
 * BudgetTracker — Per-key spend limits with daily/monthly auto-disable.
 * Data persisted to data/budgets.json.
 */
class BudgetTracker {
  constructor(filePath = null) {
    this.filePath = filePath || path.join(process.cwd(), 'data', 'budgets.json');
    this.budgets = {}; // { keyHash: { dailyLimit, monthlyLimit, spent: { yyyy-mm-dd: amount, yyyy-mm: amount } } }
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        this.budgets = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        console.log(`[BUDGET] Loaded budgets for ${Object.keys(this.budgets).length} keys`);
      }
    } catch {
      this.budgets = {};
    }
  }

  _save() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.budgets, null, 2));
    } catch (err) {
      console.log(`[BUDGET] Save failed: ${err.message}`);
    }
  }

  _dayKey() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  _monthKey() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }

  /**
   * Set budget for a key.
   */
  setBudget(keyHash, { dailyLimit, monthlyLimit }) {
    if (!this.budgets[keyHash]) {
      this.budgets[keyHash] = { dailyLimit: 0, monthlyLimit: 0, spent: {} };
    }
    if (dailyLimit !== undefined) this.budgets[keyHash].dailyLimit = dailyLimit;
    if (monthlyLimit !== undefined) this.budgets[keyHash].monthlyLimit = monthlyLimit;
    this._save();
  }

  /**
   * Record spending for a key.
   */
  recordSpend(keyHash, amount) {
    if (!this.budgets[keyHash]) return;
    const dk = this._dayKey();
    const mk = this._monthKey();
    this.budgets[keyHash].spent[dk] = (this.budgets[keyHash].spent[dk] || 0) + amount;
    this.budgets[keyHash].spent[mk] = (this.budgets[keyHash].spent[mk] || 0) + amount;
    this._save();
  }

  /**
   * Check if a key is within budget. Returns { allowed, dailySpent, monthlySpent, dailyLimit, monthlyLimit }.
   */
  checkBudget(keyHash) {
    const budget = this.budgets[keyHash];
    if (!budget) return { allowed: true };

    const dk = this._dayKey();
    const mk = this._monthKey();
    const dailySpent = budget.spent[dk] || 0;
    const monthlySpent = budget.spent[mk] || 0;

    const dailyOk = !budget.dailyLimit || dailySpent < budget.dailyLimit;
    const monthlyOk = !budget.monthlyLimit || monthlySpent < budget.monthlyLimit;

    return {
      allowed: dailyOk && monthlyOk,
      dailySpent,
      monthlySpent,
      dailyLimit: budget.dailyLimit,
      monthlyLimit: budget.monthlyLimit
    };
  }

  /**
   * Get budget status for a key.
   */
  getStatus(keyHash) {
    const budget = this.budgets[keyHash];
    if (!budget) return null;
    return { ...this.checkBudget(keyHash), keyHash };
  }

  /**
   * Get all budget statuses.
   */
  getAllStatuses() {
    const result = {};
    for (const hash of Object.keys(this.budgets)) {
      result[hash] = this.getStatus(hash);
    }
    return result;
  }

  /**
   * Remove budget for a key.
   */
  removeBudget(keyHash) {
    delete this.budgets[keyHash];
    this._save();
  }

  /**
   * Reset daily counters (called by health monitor or cron).
   */
  resetDaily() {
    const today = this._dayKey();
    for (const budget of Object.values(this.budgets)) {
      // Keep only monthly totals, clear daily totals older than today
      for (const key of Object.keys(budget.spent)) {
        if (key.includes('-') && key.length === 10 && key !== today) {
          delete budget.spent[key];
        }
      }
    }
    this._save();
  }
}

module.exports = BudgetTracker;
