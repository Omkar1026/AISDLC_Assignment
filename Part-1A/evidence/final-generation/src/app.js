const http = require('node:http');
const { createLedger } = require('./ledger');
const { dispatch, writeJson } = require('./routes');

const MAX_BODY_BYTES = 10 * 1024;

function createServer() {
  const ledger = createLedger();
  return http.createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('X-Content-Type-Options', 'nosniff');

    request.on('error', (error) => {
      console.error(error);
      if (!response.headersSent) {
        writeJson(response, 400, { error: 'Unable to read request body' });
      }
    });

    const declaredLength = Number(request.headers['content-length']);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      writeJson(response, 413, { error: 'Request body exceeds 10240 bytes' });
      request.resume();
      return;
    }

    let bodySize = 0;
    let oversized = false;
    const chunks = [];
    request.on('data', (chunk) => {
      if (oversized) {
        return;
      }
      bodySize += chunk.length;
      if (bodySize > MAX_BODY_BYTES) {
        oversized = true;
        chunks.length = 0;
        writeJson(response, 413, { error: 'Request body exceeds 10240 bytes' });
        request.resume();
        return;
      }
      chunks.push(chunk);
    });

    request.on('end', () => {
      if (oversized) {
        return;
      }
      try {
        dispatch(request, response, Buffer.concat(chunks).toString('utf8'), ledger);
      } catch (error) {
        console.error(error);
        if (!response.writableEnded) {
          writeJson(response, 500, { error: 'Internal server error' });
        }
      }
    });

  });
}

if (require.main === module) {
  const configuredPort = process.env.PORT || '3000';
  const port = Number(configuredPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error('PORT must be an integer from 0 to 65535');
    process.exitCode = 1;
  } else {
    const server = createServer();
    server.on('error', (error) => {
      console.error(error);
      process.exitCode = 1;
    });
    server.listen(port, () => {
      console.log(`Expense API listening on port ${server.address().port}`);
    });
  }
}

module.exports = { createServer };
