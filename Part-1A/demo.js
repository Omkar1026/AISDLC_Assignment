'use strict';

const { createServer } = require('./src/app');

async function request(baseUrl, method, pathname, payload, expectedStatus) {
  console.log(`\n${method} ${pathname}`);
  console.log(`Request payload: ${payload === undefined ? '(none)' : JSON.stringify(payload, null, 2)}`);

  const response = await fetch(new URL(pathname, baseUrl), {
    method,
    headers: {
      connection: 'close',
      ...(payload === undefined ? {} : { 'content-type': 'application/json' })
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) })
  });
  const json = await response.json();

  console.log(`HTTP status: ${response.status}`);
  console.log(`JSON response: ${JSON.stringify(json, null, 2)}`);
  if (response.status !== expectedStatus) {
    throw new Error(`Expected HTTP ${expectedStatus}, received ${response.status}`);
  }
}

async function main() {
  const server = createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });

    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    console.log(`Expense Split demo server listening on ephemeral port ${server.address().port}`);

    await request(baseUrl, 'POST', '/expenses', {
      payer: 'Alice',
      amount: 100,
      participants: ['Alice', 'Bob', 'Charlie'],
      description: 'Demo dinner',
      splitType: 'EQUAL'
    }, 201);
    await request(baseUrl, 'GET', '/balances', undefined, 200);
    await request(baseUrl, 'GET', '/settle', undefined, 200);
    await request(baseUrl, 'POST', '/expenses', {
      payer: 'Alice',
      amount: -10,
      participants: ['Alice', 'Bob', 'Charlie'],
      description: 'Invalid negative amount',
      splitType: 'EQUAL'
    }, 400);
  } finally {
    if (server.listening) {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
      console.log('\nExpense Split demo server closed.');
    }
  }
}

main().catch((error) => {
  console.error('Expense Split demo failed:', error.message);
  process.exitCode = 1;
});
