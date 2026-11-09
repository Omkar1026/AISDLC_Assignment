const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const fallbackReportPath = path.join(root, 'evidence', 'harness-results.json');

function validateManifest(manifest) {
  if (!manifest || manifest.version !== 1 || !Array.isArray(manifest.gates) ||
      manifest.gates.length === 0 || manifest.runner !== '.harness/harness.js') {
    throw new Error('Manifest must declare version 1, this runner, and at least one gate');
  }
  if (typeof manifest.reportPath !== 'string' || path.isAbsolute(manifest.reportPath) ||
      manifest.reportPath.split(/[\\/]/).includes('..')) {
    throw new Error('Manifest reportPath must be a safe relative path');
  }

  const ids = new Set();
  for (const gate of manifest.gates) {
    if (!gate || typeof gate.id !== 'string' || !gate.id ||
        typeof gate.name !== 'string' || !gate.name ||
        !Array.isArray(gate.command) || gate.command.length === 0 ||
        gate.command.some((part) => typeof part !== 'string' || part.length === 0) ||
        typeof gate.required !== 'boolean' || typeof gate.failOnNonZero !== 'boolean') {
      throw new Error('Each gate must have an id, name, command array, required flag, and failOnNonZero flag');
    }
    if (ids.has(gate.id)) {
      throw new Error(`Duplicate gate id: ${gate.id}`);
    }
    ids.add(gate.id);
  }

  return path.resolve(root, manifest.reportPath);
}

function runGate(gate) {
  const started = Date.now();
  const [executable, ...args] = gate.command;
  const command = executable === 'node' ? process.execPath : executable;
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    shell: false,
    windowsHide: true
  });
  const error = result.error ? result.error.message : null;
  const exitCode = result.status;
  const status = !error && exitCode === 0 ? 'passed' : 'failed';
  return {
    id: gate.id,
    name: gate.name,
    command: gate.command,
    required: gate.required,
    status,
    exitCode,
    signal: result.signal || null,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error,
    durationMs: Date.now() - started
  };
}

function writeReport(reportPath, report) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function main() {
  const startedAt = new Date().toISOString();
  let reportPath = fallbackReportPath;
  let report;

  try {
    const manifestPath = path.join(__dirname, 'quality-gates.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    reportPath = validateManifest(manifest);
    const gates = manifest.gates.map(runGate);
    const failedRequiredGate = gates.some((gate) => gate.required && gate.status !== 'passed');
    report = {
      version: 1,
      status: failedRequiredGate ? 'failed' : 'passed',
      startedAt,
      completedAt: new Date().toISOString(),
      gates
    };
    writeReport(reportPath, report);
    process.stdout.write(`${report.status.toUpperCase()}: ${gates.filter((gate) => gate.status === 'passed').length}/${gates.length} gates passed.\n`);
    process.stdout.write(`Report: ${path.relative(root, reportPath)}\n`);
    if (failedRequiredGate) {
      process.exitCode = 1;
    }
  } catch (error) {
    report = {
      version: 1,
      status: 'failed',
      startedAt,
      completedAt: new Date().toISOString(),
      error: error.message,
      gates: []
    };
    try {
      writeReport(reportPath, report);
    } catch (writeError) {
      console.error(`Unable to write harness report: ${writeError.message}`);
    }
    console.error(`Harness failed: ${error.message}`);
    process.exitCode = 1;
  }
}

main();
