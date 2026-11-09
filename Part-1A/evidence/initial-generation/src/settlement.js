function compareNames(left, right) {
  if (left.name < right.name) {
    return -1;
  }
  if (left.name > right.name) {
    return 1;
  }
  return 0;
}

function compareByAmountThenName(left, right) {
  if (left.cents !== right.cents) {
    return right.cents - left.cents;
  }
  return compareNames(left, right);
}

function createSettlement(balances) {
  const debtors = [];
  const creditors = [];
  for (const [name, cents] of balances) {
    if (cents < 0) {
      debtors.push({ name, cents: -cents });
    } else if (cents > 0) {
      creditors.push({ name, cents });
    }
  }

  debtors.sort(compareByAmountThenName);
  creditors.sort(compareByAmountThenName);
  const transfers = [];
  let debtorIndex = 0;
  let creditorIndex = 0;
  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const cents = Math.min(debtor.cents, creditor.cents);
    if (!Number.isSafeInteger(cents) || cents <= 0) {
      throw new Error('Settlement generated an invalid transfer amount');
    }
    transfers.push({ from: debtor.name, to: creditor.name, amountCents: cents });
    debtor.cents -= cents;
    creditor.cents -= cents;
    if (debtor.cents === 0) {
      debtorIndex += 1;
    }
    if (creditor.cents === 0) {
      creditorIndex += 1;
    }
  }

  if (debtorIndex !== debtors.length || creditorIndex !== creditors.length) {
    throw new Error('Settlement could not clear all ledger balances');
  }
  return transfers;
}

module.exports = { createSettlement };
