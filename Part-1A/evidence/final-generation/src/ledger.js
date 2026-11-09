const { ValidationError } = require('./validation');

function createLedger() {
  let expenses = [];
  let balances = new Map();
  let nextId = 1;

  function recordExpense(expense) {
    const shares = expense.sharesCents;
    const shareTotal = expense.participants.reduce(
      (total, participant) => total + BigInt(shares[participant]),
      0n
    );
    if (shareTotal !== BigInt(expense.amountCents)) {
      throw new ValidationError('Expense shares must sum to the expense amount');
    }

    const deltas = new Map();
    const addDelta = (name, value) => {
      const updated = (deltas.get(name) || 0) + value;
      if (!Number.isSafeInteger(updated)) {
        throw new ValidationError('Ledger update exceeds the supported balance range');
      }
      deltas.set(name, updated);
    };

    addDelta(expense.payer, expense.amountCents);
    for (const participant of expense.participants) {
      addDelta(participant, -shares[participant]);
    }

    const updatedBalances = new Map(balances);
    for (const [name, delta] of deltas) {
      const updated = (updatedBalances.get(name) || 0) + delta;
      if (!Number.isSafeInteger(updated)) {
        throw new ValidationError('Ledger update exceeds the supported balance range');
      }
      updatedBalances.set(name, updated);
    }
    const balanceTotal = [...updatedBalances.values()].reduce(
      (total, balance) => total + BigInt(balance),
      0n
    );
    if (balanceTotal !== 0n) {
      throw new Error('Ledger zero-sum invariant failed');
    }

    const id = `expense-${nextId}`;
    const recorded = {
      id,
      payer: expense.payer,
      amountCents: expense.amountCents,
      participants: [...expense.participants],
      description: expense.description,
      splitType: expense.splitType,
      sharesCents: { ...shares }
    };
    balances = updatedBalances;
    expenses.push(recorded);
    nextId += 1;

    const responseShares = Object.create(null);
    for (const participant of expense.participants) {
      responseShares[participant] = shares[participant];
    }
    return { id, sharesCents: responseShares };
  }

  function getBalances() {
    return new Map(balances);
  }

  function reset() {
    expenses = [];
    balances = new Map();
  }

  return { getBalances, recordExpense, reset };
}

module.exports = { createLedger };
