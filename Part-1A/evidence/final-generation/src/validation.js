const MAX_EXPENSE_AMOUNT = 1000000000;
const MAX_SAFE_CENTS = BigInt(Number.MAX_SAFE_INTEGER);

class ValidationError extends Error {}

function assertSafeCents(cents, fieldName) {
  if (cents < 0n || cents > MAX_SAFE_CENTS) {
    throw new ValidationError(`${fieldName} is outside the supported monetary range`);
  }
  return Number(cents);
}

function decimalParts(value) {
  const match = /^(-?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(value.toString());
  if (!match) {
    throw new ValidationError('Amount must be a finite number');
  }

  const fraction = match[3] || '';
  const exponent = Number(match[4] || 0);
  const coefficient = BigInt(`${match[1]}${match[2]}${fraction}`);
  return { coefficient, exponent, fractionLength: fraction.length };
}

function toCents(value, fieldName) {
  if (!Number.isFinite(value)) {
    throw new ValidationError(`${fieldName} must be a finite number`);
  }

  const { coefficient, exponent, fractionLength } = decimalParts(value);
  const centShift = exponent - fractionLength + 2;
  let cents;
  if (centShift >= 0) {
    cents = coefficient * (10n ** BigInt(centShift));
  } else {
    const divisor = 10n ** BigInt(-centShift);
    cents = (coefficient + divisor / 2n) / divisor;
  }
  return assertSafeCents(cents, fieldName);
}

function valuesWithinTolerance(values, expected, toleranceNumerator, toleranceDenominator) {
  const parts = values.concat(expected).map(decimalParts);
  const scale = Math.max(0, ...parts.map((part) => part.fractionLength - part.exponent));
  const scaledValues = parts.map((part) => {
    const shift = part.exponent - part.fractionLength + scale;
    return part.coefficient * (10n ** BigInt(shift));
  });
  const expectedValue = scaledValues.pop();
  const sum = scaledValues.reduce((total, value) => total + value, 0n);
  const difference = sum >= expectedValue ? sum - expectedValue : expectedValue - sum;
  return difference * BigInt(toleranceDenominator) <=
    (10n ** BigInt(scale)) * BigInt(toleranceNumerator);
}

function roundRatioHalfUp(numerator, denominator) {
  return (2n * numerator + denominator) / (2n * denominator);
}

function validateExpense(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError('Request body must be a JSON object');
  }

  const allowedFields = new Set([
    'payer',
    'amount',
    'participants',
    'description',
    'splitType',
    'exactShares'
  ]);
  for (const key of Object.keys(input)) {
    if (!allowedFields.has(key)) {
      throw new ValidationError(`Unknown field: ${key}`);
    }
  }

  for (const field of ['payer', 'amount', 'participants', 'description', 'splitType']) {
    if (!Object.hasOwn(input, field)) {
      throw new ValidationError(`Missing required field: ${field}`);
    }
  }
  if (typeof input.payer !== 'string' || input.payer.trim().length === 0) {
    throw new ValidationError('payer must be a non-empty string');
  }
  if (typeof input.description !== 'string') {
    throw new ValidationError('description must be a string');
  }
  if (typeof input.amount !== 'number' || !Number.isFinite(input.amount) || input.amount <= 0) {
    throw new ValidationError('amount must be a finite positive number');
  }
  if (input.amount > MAX_EXPENSE_AMOUNT) {
    throw new ValidationError('amount exceeds the maximum of 1000000000.00');
  }
  if (!Array.isArray(input.participants) || input.participants.length < 2) {
    throw new ValidationError('participants must contain at least two names');
  }

  const participants = input.participants.map((participant) => {
    if (typeof participant !== 'string' || participant.trim().length === 0) {
      throw new ValidationError('participant names must be non-empty strings');
    }
    return participant.trim();
  });
  if (new Set(participants).size !== participants.length) {
    throw new ValidationError('participants must be unique');
  }

  if (input.splitType !== 'EQUAL' && input.splitType !== 'EXACT') {
    throw new ValidationError('splitType must be EQUAL or EXACT');
  }

  const amountCents = toCents(input.amount, 'amount');
  if (amountCents <= 0) {
    throw new ValidationError('amount must round to at least 0.01');
  }

  const sharesCents = Object.create(null);
  if (input.splitType === 'EQUAL') {
    if (Object.hasOwn(input, 'exactShares')) {
      throw new ValidationError('exactShares is not allowed for EQUAL splits');
    }
    const total = BigInt(amountCents);
    const roundedShare = roundRatioHalfUp(total, BigInt(participants.length));
    const remainder = total - roundedShare * BigInt(participants.length);
    const firstShare = roundedShare + remainder;
    if (firstShare < 0n) {
      throw new ValidationError('equal-split rounding would produce a negative share');
    }
    participants.forEach((participant, index) => {
      sharesCents[participant] = assertSafeCents(
        index === 0 ? firstShare : roundedShare,
        'share'
      );
    });
  } else {
    const exactShares = input.exactShares;
    if (!exactShares || typeof exactShares !== 'object' || Array.isArray(exactShares)) {
      throw new ValidationError('exactShares must be an object');
    }
    const shareNames = Object.keys(exactShares);
    if (shareNames.length !== participants.length ||
        participants.some((participant) => !Object.hasOwn(exactShares, participant))) {
      throw new ValidationError('exactShares keys must match participants exactly');
    }

    const values = participants.map((participant) => exactShares[participant]);
    if (values.some((value) => typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
      throw new ValidationError('exactShares values must be finite non-negative numbers');
    }
    if (!valuesWithinTolerance(values, input.amount, 1, 1000)) {
      throw new ValidationError('exactShares total must be within 0.001 of amount');
    }

    let shareTotal = 0n;
    participants.forEach((participant, index) => {
      const cents = BigInt(toCents(values[index], `exactShares.${participant}`));
      shareTotal += cents;
      sharesCents[participant] = Number(cents);
    });
    if (shareTotal !== BigInt(amountCents)) {
      throw new ValidationError('rounded exactShares must equal the rounded amount');
    }
  }

  return {
    payer: input.payer.trim(),
    amountCents,
    participants,
    description: input.description,
    splitType: input.splitType,
    sharesCents
  };
}

function centsToAmount(cents) {
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError('Monetary value must be a safe integer number of cents');
  }
  return Number((cents / 100).toFixed(2));
}

module.exports = {
  MAX_EXPENSE_AMOUNT,
  ValidationError,
  centsToAmount,
  toCents,
  validateExpense
};
