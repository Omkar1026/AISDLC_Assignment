const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createServer } = require('../src/app');
const { createLedger } = require('../src/ledger');

const BODY_LIMIT = 10 * 1024;
const MAX_AMOUNT = 1000000000;

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve(server.address());
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function request(server, method, requestPath, body, extraHeaders = {}) {
  const address = server.address();
  const data = body === undefined ? undefined : Buffer.from(body);
  const headers = { ...extraHeaders };
  if (data) {
    headers['content-type'] = 'application/json';
    if (headers['transfer-encoding'] !== 'chunked') {
      headers['content-length'] = data.length;
    }
  }

  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: address.port,
      method,
      path: requestPath,
      headers
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json;
        try {
          json = JSON.parse(text);
        } catch (error) {
          reject(error);
          return;
        }
        resolve({ status: res.statusCode, headers: res.headers, json, text });
      });
    });
    req.once('error', reject);
    if (data) {
      req.write(data);
    }
    req.end();
  });
}

function expense(payer, amount, participants, exactShares, description = 'test') {
  return {
    payer,
    amount,
    participants,
    description,
    splitType: 'EXACT',
    exactShares
  };
}

function assertHeaders(response) {
  assert.equal(response.headers['content-type'], 'application/json');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
}

async function withServer(t) {
  const server = createServer();
  await listen(server);
  t.after(() => close(server));
  return server;
}

test('importing src/app.js does not bind a listener and uses a configurable port', () => {
  const server = createServer();
  assert.equal(server.listening, false);
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
  assert.match(appSource, /process\.env\.PORT/);
});

test('POST /expenses validates and records EQUAL and EXACT expenses', async (t) => {
  const server = await withServer(t);

  const equalResponse = await request(server, 'POST', '/expenses', JSON.stringify({
    payer: 'Alice',
    amount: 10,
    participants: ['Alice', 'Bob', 'Chen'],
    description: 'Lunch',
    splitType: 'EQUAL'
  }));
  assert.equal(equalResponse.status, 201);
  assert.equal(typeof equalResponse.json.id, 'string');
  assert.deepEqual(equalResponse.json.shares, { Alice: 3.34, Bob: 3.33, Chen: 3.33 });
  assertHeaders(equalResponse);

  const sixWay = await request(server, 'POST', '/expenses', JSON.stringify({
    payer: 'Payer',
    amount: 10,
    participants: ['A', 'B', 'C', 'D', 'E', 'F'],
    description: 'Remainder over one cent',
    splitType: 'EQUAL'
  }));
  assert.equal(sixWay.status, 201);
  assert.deepEqual(Object.values(sixWay.json.shares), [1.65, 1.67, 1.67, 1.67, 1.67, 1.67]);
  assert.equal(Object.values(sixWay.json.shares).reduce((sum, share) => sum + share, 0), 10);
  assert.equal(Object.values(sixWay.json.shares)[0], 1.65);

  const exactResponse = await request(server, 'POST', '/expenses', JSON.stringify(
    expense('Payer', 10, ['A', 'B'], { A: 6, B: 4 })
  ));
  assert.equal(exactResponse.status, 201);
  assert.deepEqual(exactResponse.json.shares, { A: 6, B: 4 });
  assertHeaders(exactResponse);

  const toleranceResponse = await request(server, 'POST', '/expenses', JSON.stringify(
    expense('Payer', 10, ['A', 'B'], { A: 4.999, B: 5 })
  ));
  assert.equal(toleranceResponse.status, 201);
  assert.deepEqual(toleranceResponse.json.shares, { A: 5, B: 5 });
});

test('POST /expenses rejects invalid requests without changing the ledger', async (t) => {
  const server = await withServer(t);
  const accepted = await request(server, 'POST', '/expenses', JSON.stringify(
    expense('Payer', 12, ['A', 'B'], { A: 7, B: 5 })
  ));
  assert.equal(accepted.status, 201);
  const before = await request(server, 'GET', '/balances');

  const invalidCases = [
    { name: 'missing required field', body: { payer: 'P', participants: ['A', 'B'], description: 'x', splitType: 'EQUAL' } },
    { name: 'non-string payer', body: { payer: 2, amount: 1, participants: ['A', 'B'], description: 'x', splitType: 'EQUAL' } },
    { name: 'non-string description', body: { payer: 'P', amount: 1, participants: ['A', 'B'], description: 2, splitType: 'EQUAL' } },
    { name: 'string amount', body: { payer: 'P', amount: '1', participants: ['A', 'B'], description: 'x', splitType: 'EQUAL' } },
    { name: 'non-positive amount', body: { payer: 'P', amount: 0, participants: ['A', 'B'], description: 'x', splitType: 'EQUAL' } },
    { name: 'amount rounding to zero', body: { payer: 'P', amount: 0.001, participants: ['A', 'B'], description: 'x', splitType: 'EQUAL' } },
    { name: 'one participant', body: { payer: 'P', amount: 1, participants: ['A'], description: 'x', splitType: 'EQUAL' } },
    { name: 'non-string participant', body: { payer: 'P', amount: 1, participants: ['A', 2], description: 'x', splitType: 'EQUAL' } },
    { name: 'empty participant', body: { payer: 'P', amount: 1, participants: ['A', '  '], description: 'x', splitType: 'EQUAL' } },
    { name: 'duplicate trimmed participants', body: { payer: 'P', amount: 1, participants: ['A', ' A '], description: 'x', splitType: 'EQUAL' } },
    { name: 'invalid split type', body: { payer: 'P', amount: 1, participants: ['A', 'B'], description: 'x', splitType: 'EVEN' } },
    { name: 'unknown field', body: { payer: 'P', amount: 1, participants: ['A', 'B'], description: 'x', splitType: 'EQUAL', note: 'extra' } },
    { name: 'exactShares on EQUAL', body: { payer: 'P', amount: 1, participants: ['A', 'B'], description: 'x', splitType: 'EQUAL', exactShares: { A: 0.5, B: 0.5 } } },
    { name: 'missing exactShares', body: { payer: 'P', amount: 1, participants: ['A', 'B'], description: 'x', splitType: 'EXACT' } },
    { name: 'exactShares key mismatch', body: expense('P', 1, ['A', 'B'], { A: 1, C: 0 }) },
    { name: 'negative exact share', body: expense('P', 1, ['A', 'B'], { A: 1.1, B: -0.1 }) },
    { name: 'non-number exact share', body: expense('P', 1, ['A', 'B'], { A: '1', B: 0 }) },
    { name: 'exact sum exceeds tolerance', body: expense('P', 10, ['A', 'B'], { A: 4.9989, B: 5 }) },
    { name: 'rounded exact shares do not total amount', body: expense('P', 10, ['A', 'B'], { A: 5.005, B: 4.995 }) }
  ];

  for (const invalid of invalidCases) {
    const response = await request(server, 'POST', '/expenses', JSON.stringify(invalid.body));
    assert.equal(response.status, 400, invalid.name);
    assert.equal(typeof response.json.error, 'string', invalid.name);
    assertHeaders(response);
    const after = await request(server, 'GET', '/balances');
    assert.deepEqual(after.json, before.json, invalid.name);
  }

  for (const malformed of ['{', 'null', '[]']) {
    const response = await request(server, 'POST', '/expenses', malformed);
    assert.equal(response.status, 400);
    assert.equal(typeof response.json.error, 'string');
    assertHeaders(response);
  }

  const overLimit = await request(server, 'POST', '/expenses', JSON.stringify({
    payer: 'P',
    amount: MAX_AMOUNT + 0.01,
    participants: ['A', 'B'],
    description: 'over maximum',
    splitType: 'EQUAL'
  }));
  assert.equal(overLimit.status, 400);
  const afterLimit = await request(server, 'GET', '/balances');
  assert.deepEqual(afterLimit.json, before.json);
});

test('POST /expenses accepts the maximum amount', async (t) => {
  const server = await withServer(t);
  const atLimit = await request(server, 'POST', '/expenses', JSON.stringify(
    expense('Payer', MAX_AMOUNT, ['A', 'B'], { A: 500000000, B: 500000000 })
  ));
  assert.equal(atLimit.status, 201);
  assert.deepEqual(atLimit.json.shares, { A: 500000000, B: 500000000 });
});

test('ledger rejects an unsafe aggregate atomically', () => {
  const ledger = createLedger();
  const largeExpense = {
    payer: 'Payer',
    amountCents: Number.MAX_SAFE_INTEGER,
    participants: ['A', 'B'],
    sharesCents: { A: Number.MAX_SAFE_INTEGER, B: 0 },
    description: 'boundary',
    splitType: 'EXACT'
  };
  ledger.recordExpense(largeExpense);
  const before = ledger.getBalances();

  assert.throws(() => ledger.recordExpense({
    ...largeExpense,
    amountCents: 1,
    sharesCents: { A: 1, B: 0 }
  }), /supported balance range/);
  assert.deepEqual(ledger.getBalances(), before);
});

test('GET /balances includes payers and participants with correct zero-sum signs', async (t) => {
  const server = await withServer(t);
  const empty = await request(server, 'GET', '/balances');
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.json, { balances: {} });
  assertHeaders(empty);

  const recorded = await request(server, 'POST', '/expenses', JSON.stringify(
    expense('Payer', 10, ['A', 'B'], { A: 5, B: 5 })
  ));
  assert.equal(recorded.status, 201);
  const balances = await request(server, 'GET', '/balances');
  assert.equal(balances.status, 200);
  assert.deepEqual(balances.json.balances, { Payer: 10, A: -5, B: -5 });
  assert.equal(Object.values(balances.json.balances).reduce((sum, value) => sum + value, 0), 0);
  assertHeaders(balances);

  await request(server, 'DELETE', '/reset');
  await request(server, 'POST', '/expenses', JSON.stringify(
    expense('A', 6, ['A', 'B'], { A: 6, B: 0 })
  ));
  const zeroBalance = await request(server, 'GET', '/balances');
  assert.deepEqual(zeroBalance.json.balances, { A: 0, B: 0 });
});

test('GET /settle returns deterministic largest-first transfers and settles balances', async (t) => {
  const server = await withServer(t);
  await request(server, 'POST', '/expenses', JSON.stringify(
    expense('A', 10, ['D1', 'D2'], { D1: 8, D2: 2 })
  ));
  await request(server, 'POST', '/expenses', JSON.stringify(
    expense('B', 6, ['D2', 'D3'], { D2: 1, D3: 5 })
  ));

  const first = await request(server, 'GET', '/settle');
  const second = await request(server, 'GET', '/settle');
  assert.equal(first.status, 200);
  assert.deepEqual(first.json, [
    { from: 'D1', to: 'A', amount: 8 },
    { from: 'D3', to: 'A', amount: 2 },
    { from: 'D3', to: 'B', amount: 3 },
    { from: 'D2', to: 'B', amount: 3 }
  ]);
  assert.deepEqual(second.json, first.json);
  assertHeaders(first);

  const balances = (await request(server, 'GET', '/balances')).json.balances;
  const remaining = { ...balances };
  for (const transfer of first.json) {
    remaining[transfer.from] += transfer.amount;
    remaining[transfer.to] -= transfer.amount;
  }
  assert.ok(first.json.length <= Object.values(balances).filter((value) => value !== 0).length - 1);
  assert.deepEqual(remaining, { A: 0, D1: 0, D2: 0, B: 0, D3: 0 });
});

test('GET /settle applies alphabetical tie-breaking for debtors and creditors', async (t) => {
  const server = await withServer(t);
  await request(server, 'POST', '/expenses', JSON.stringify(
    expense('Bob', 20, ['Uma', 'Tom'], { Uma: 10, Tom: 10 })
  ));
  await request(server, 'POST', '/expenses', JSON.stringify(
    expense('Alice', 20, ['Uma', 'Tom'], { Uma: 10, Tom: 10 })
  ));
  const response = await request(server, 'GET', '/settle');
  assert.deepEqual(response.json, [
    { from: 'Tom', to: 'Alice', amount: 20 },
    { from: 'Uma', to: 'Bob', amount: 20 }
  ]);
});

test('GET /settle returns an empty plan when the ledger has no debts', async (t) => {
  const server = await withServer(t);
  const response = await request(server, 'GET', '/settle');
  assert.equal(response.status, 200);
  assert.deepEqual(response.json, []);
  assertHeaders(response);
});

test('DELETE /reset clears populated and already-empty ledgers', async (t) => {
  const server = await withServer(t);
  await request(server, 'POST', '/expenses', JSON.stringify(
    expense('Payer', 10, ['A', 'B'], { A: 5, B: 5 })
  ));
  const reset = await request(server, 'DELETE', '/reset');
  assert.equal(reset.status, 200);
  assert.equal(typeof reset.json.message, 'string');
  assertHeaders(reset);
  assert.deepEqual((await request(server, 'GET', '/balances')).json, { balances: {} });
  assert.deepEqual((await request(server, 'GET', '/settle')).json, []);

  const secondReset = await request(server, 'DELETE', '/reset');
  assert.equal(secondReset.status, 200);
  assertHeaders(secondReset);
});

test('all endpoints enforce response headers, 404 behavior, and the 10KB body limit', async (t) => {
  const server = await withServer(t);
  const unknownPath = await request(server, 'GET', '/unknown');
  assert.equal(unknownPath.status, 404);
  assert.equal(typeof unknownPath.json.error, 'string');
  assertHeaders(unknownPath);

  const wrongMethod = await request(server, 'PUT', '/balances');
  assert.equal(wrongMethod.status, 404);
  assertHeaders(wrongMethod);

  const valid = {
    payer: 'Payer',
    amount: 1,
    participants: ['A', 'B'],
    description: '',
    splitType: 'EQUAL'
  };
  const json = JSON.stringify(valid);
  const exactLimitBody = json + ' '.repeat(BODY_LIMIT - Buffer.byteLength(json));
  assert.equal(Buffer.byteLength(exactLimitBody), BODY_LIMIT);
  const exactLimit = await request(server, 'POST', '/expenses', exactLimitBody);
  assert.equal(exactLimit.status, 201);
  assertHeaders(exactLimit);
  const beforeOversized = await request(server, 'GET', '/balances');

  const tooLargeBody = exactLimitBody + ' ';
  assert.equal(Buffer.byteLength(tooLargeBody), BODY_LIMIT + 1);
  const oversized = await request(server, 'POST', '/expenses', tooLargeBody);
  assert.equal(oversized.status, 413);
  assert.equal(typeof oversized.json.error, 'string');
  assertHeaders(oversized);
  assert.deepEqual((await request(server, 'GET', '/balances')).json, beforeOversized.json);

  const chunkedOversized = await request(server, 'POST', '/expenses', tooLargeBody, {
    'transfer-encoding': 'chunked'
  });
  assert.equal(chunkedOversized.status, 413);
  assertHeaders(chunkedOversized);
  assert.deepEqual((await request(server, 'GET', '/balances')).json, beforeOversized.json);
});
