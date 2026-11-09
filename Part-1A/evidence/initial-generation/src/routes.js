const { createSettlement } = require('./settlement');
const { ValidationError, centsToAmount, validateExpense } = require('./validation');

function writeJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.end(JSON.stringify(payload));
}

function errorResponse(response, status, message) {
  writeJson(response, status, { error: message });
}

function parseJson(body) {
  try {
    return JSON.parse(body);
  } catch {
    throw new ValidationError('Request body must contain valid JSON');
  }
}

function dispatch(request, response, body, ledger) {
  let pathname;
  try {
    pathname = new URL(request.url, 'http://localhost').pathname;
  } catch {
    errorResponse(response, 404, 'Route not found');
    return;
  }

  if (request.method === 'POST' && pathname === '/expenses') {
    try {
      const expense = validateExpense(parseJson(body));
      const recorded = ledger.recordExpense(expense);
      const shares = Object.create(null);
      for (const [name, cents] of Object.entries(recorded.sharesCents)) {
        shares[name] = centsToAmount(cents);
      }
      writeJson(response, 201, { id: recorded.id, shares });
    } catch (error) {
      if (error instanceof ValidationError) {
        errorResponse(response, 400, error.message);
        return;
      }
      throw error;
    }
    return;
  }

  if (request.method === 'GET' && pathname === '/balances') {
    const balances = Object.create(null);
    for (const [name, cents] of ledger.getBalances()) {
      balances[name] = centsToAmount(cents);
    }
    writeJson(response, 200, { balances });
    return;
  }

  if (request.method === 'GET' && pathname === '/settle') {
    const transfers = createSettlement(ledger.getBalances()).map((transfer) => ({
      from: transfer.from,
      to: transfer.to,
      amount: centsToAmount(transfer.amountCents)
    }));
    writeJson(response, 200, transfers);
    return;
  }

  if (request.method === 'DELETE' && pathname === '/reset') {
    ledger.reset();
    writeJson(response, 200, { message: 'Ledger reset' });
    return;
  }

  errorResponse(response, 404, 'Route not found');
}

module.exports = { dispatch, writeJson };
