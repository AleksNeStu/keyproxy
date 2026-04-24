const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const BudgetTracker = require('../../src/core/budgetTracker');

describe('BudgetTracker', () => {
  let tracker;
  let tempDir;
  let tempFile;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-test-'));
    tempFile = path.join(tempDir, 'budgets.json');
    tracker = new BudgetTracker(tempFile);
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      if (fs.existsSync(tempDir)) fs.rmdirSync(tempDir);
    } catch {}
  });

  describe('constructor', () => {
    it('creates new tracker with empty budgets', () => {
      assert.deepEqual(tracker.budgets, {});
    });

    it('loads existing data from file', () => {
      const data = { key1: { dailyLimit: 10, monthlyLimit: 100, spent: {} } };
      fs.writeFileSync(tempFile, JSON.stringify(data));

      const loaded = new BudgetTracker(tempFile);
      assert.ok(loaded.budgets.key1);
      assert.equal(loaded.budgets.key1.dailyLimit, 10);
    });
  });

  describe('setBudget', () => {
    it('sets daily and monthly limits', () => {
      tracker.setBudget('key1', { dailyLimit: 10, monthlyLimit: 100 });

      assert.equal(tracker.budgets.key1.dailyLimit, 10);
      assert.equal(tracker.budgets.key1.monthlyLimit, 100);
    });

    it('sets only daily limit', () => {
      tracker.setBudget('key1', { dailyLimit: 10 });
      assert.equal(tracker.budgets.key1.dailyLimit, 10);
      assert.equal(tracker.budgets.key1.monthlyLimit, 0);
    });

    it('sets only monthly limit', () => {
      tracker.setBudget('key1', { monthlyLimit: 100 });
      assert.equal(tracker.budgets.key1.dailyLimit, 0);
      assert.equal(tracker.budgets.key1.monthlyLimit, 100);
    });

    it('updates existing budget', () => {
      tracker.setBudget('key1', { dailyLimit: 10, monthlyLimit: 100 });
      tracker.setBudget('key1', { dailyLimit: 20 });

      assert.equal(tracker.budgets.key1.dailyLimit, 20);
      assert.equal(tracker.budgets.key1.monthlyLimit, 100);
    });

    it('persists to file', () => {
      tracker.setBudget('key1', { dailyLimit: 10, monthlyLimit: 100 });

      const raw = fs.readFileSync(tempFile, 'utf8');
      const data = JSON.parse(raw);
      assert.equal(data.key1.dailyLimit, 10);
    });
  });

  describe('recordSpend', () => {
    it('records spending for a key', () => {
      tracker.setBudget('key1', { dailyLimit: 100, monthlyLimit: 1000 });
      tracker.recordSpend('key1', 5.50);

      const status = tracker.checkBudget('key1');
      assert.equal(status.dailySpent, 5.50);
      assert.equal(status.monthlySpent, 5.50);
    });

    it('accumulates spending', () => {
      tracker.setBudget('key1', { dailyLimit: 100, monthlyLimit: 1000 });
      tracker.recordSpend('key1', 10);
      tracker.recordSpend('key1', 20);

      const status = tracker.checkBudget('key1');
      assert.equal(status.dailySpent, 30);
    });

    it('does nothing for key without budget', () => {
      tracker.recordSpend('unknown-key', 100);
      // Should not throw
    });
  });

  describe('checkBudget', () => {
    it('returns allowed=true for key without budget', () => {
      const result = tracker.checkBudget('unknown');
      assert.equal(result.allowed, true);
    });

    it('returns allowed=true when within limits', () => {
      tracker.setBudget('key1', { dailyLimit: 100, monthlyLimit: 1000 });
      tracker.recordSpend('key1', 10);

      const result = tracker.checkBudget('key1');
      assert.equal(result.allowed, true);
      assert.equal(result.dailySpent, 10);
    });

    it('returns allowed=false when daily limit exceeded', () => {
      tracker.setBudget('key1', { dailyLimit: 10, monthlyLimit: 1000 });
      tracker.recordSpend('key1', 15);

      const result = tracker.checkBudget('key1');
      assert.equal(result.allowed, false);
    });

    it('returns allowed=false when monthly limit exceeded', () => {
      tracker.setBudget('key1', { dailyLimit: 1000, monthlyLimit: 10 });
      tracker.recordSpend('key1', 15);

      const result = tracker.checkBudget('key1');
      assert.equal(result.allowed, false);
    });

    it('returns limits in result', () => {
      tracker.setBudget('key1', { dailyLimit: 50, monthlyLimit: 500 });

      const result = tracker.checkBudget('key1');
      assert.equal(result.dailyLimit, 50);
      assert.equal(result.monthlyLimit, 500);
    });

    it('allows spending when limits are 0 (disabled)', () => {
      tracker.setBudget('key1', { dailyLimit: 0, monthlyLimit: 0 });
      tracker.recordSpend('key1', 999);

      const result = tracker.checkBudget('key1');
      assert.equal(result.allowed, true);
    });
  });

  describe('getStatus', () => {
    it('returns null for unknown key', () => {
      assert.equal(tracker.getStatus('unknown'), null);
    });

    it('returns full status with keyHash', () => {
      tracker.setBudget('key1', { dailyLimit: 100, monthlyLimit: 1000 });

      const status = tracker.getStatus('key1');
      assert.equal(status.keyHash, 'key1');
      assert.equal(status.dailyLimit, 100);
      assert.equal(status.monthlyLimit, 1000);
      assert.equal(status.allowed, true);
    });
  });

  describe('getAllStatuses', () => {
    it('returns empty for no budgets', () => {
      assert.deepEqual(tracker.getAllStatuses(), {});
    });

    it('returns all budget statuses', () => {
      tracker.setBudget('key1', { dailyLimit: 10, monthlyLimit: 100 });
      tracker.setBudget('key2', { dailyLimit: 20, monthlyLimit: 200 });

      const statuses = tracker.getAllStatuses();
      assert.ok(statuses.key1);
      assert.ok(statuses.key2);
      assert.equal(statuses.key1.dailyLimit, 10);
      assert.equal(statuses.key2.dailyLimit, 20);
    });
  });

  describe('removeBudget', () => {
    it('removes a budget', () => {
      tracker.setBudget('key1', { dailyLimit: 10, monthlyLimit: 100 });
      tracker.removeBudget('key1');

      assert.equal(tracker.budgets.key1, undefined);
    });

    it('persists removal', () => {
      tracker.setBudget('key1', { dailyLimit: 10, monthlyLimit: 100 });
      tracker.removeBudget('key1');

      const raw = fs.readFileSync(tempFile, 'utf8');
      const data = JSON.parse(raw);
      assert.equal(data.key1, undefined);
    });
  });

  describe('resetDaily', () => {
    it('clears old daily counters', () => {
      tracker.setBudget('key1', { dailyLimit: 100, monthlyLimit: 1000 });

      // Manually inject old daily entries
      tracker.budgets.key1.spent['2024-01-01'] = 50;
      tracker.budgets.key1.spent['2024-01-02'] = 30;
      const today = new Date().toISOString().slice(0, 10);
      tracker.budgets.key1.spent[today] = 10;
      // Also a monthly entry
      const month = new Date().toISOString().slice(0, 7);
      tracker.budgets.key1.spent[month] = 100;

      tracker.resetDaily();

      assert.equal(tracker.budgets.key1.spent['2024-01-01'], undefined);
      assert.equal(tracker.budgets.key1.spent['2024-01-02'], undefined);
      assert.equal(tracker.budgets.key1.spent[today], 10);
      assert.equal(tracker.budgets.key1.spent[month], 100);
    });
  });
});
