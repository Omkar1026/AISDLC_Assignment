const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sourceDirectory = path.join(root, 'src');
const violations = [];
const sourceFiles = [];

function collectJavaScript(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectJavaScript(entryPath);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      sourceFiles.push(entryPath);
    }
  }
}

function check(pattern, message, fileName) {
  if (pattern.test(fileName.contents)) {
    violations.push(`${path.relative(root, fileName.path)}: ${message}`);
  }
}

try {
  collectJavaScript(sourceDirectory);
  if (sourceFiles.length === 0) {
    throw new Error('No JavaScript source files were found in src/');
  }

  const files = sourceFiles.map((filePath) => ({
    path: filePath,
    contents: fs.readFileSync(filePath, 'utf8')
  }));
  for (const file of files) {
    check(new RegExp('\\beval\\s*\\('), 'eval() is prohibited', file);
    check(new RegExp('\\bnew\\s+Function\\s*\\('), 'new Function() is prohibited', file);
    check(
      /(password|secret|api[_-]?key|token)\s*[:=]\s*(['"])[^'"]{8,}\2/i,
      'possible hardcoded secret',
      file
    );
  }

  const allSource = files.map((file) => file.contents).join('\n');
  const requirements = [
    [new RegExp("setHeader\\s*\\(\\s*['\"]Content-Type['\"]\\s*,\\s*['\"]application/json['\"]"), 'Content-Type: application/json must be set'],
    [new RegExp("setHeader\\s*\\(\\s*['\"]X-Content-Type-Options['\"]\\s*,\\s*['\"]nosniff['\"]"), 'X-Content-Type-Options: nosniff must be set'],
    [new RegExp('MAX_BODY_BYTES\\s*=\\s*10\\s*\\*\\s*1024'), 'the request body limit must be 10KB'],
    [new RegExp('bodySize\\s*>\\s*MAX_BODY_BYTES'), 'streamed request bytes must be checked against the limit'],
    [new RegExp('declaredLength\\s*>\\s*MAX_BODY_BYTES'), 'declared request length must be checked against the limit']
  ];
  for (const [pattern, message] of requirements) {
    if (!pattern.test(allSource)) {
      violations.push(message);
    }
  }

  if (violations.length > 0) {
    process.stderr.write(`Security / SAST Guard failed:\n${violations.map((item) => `- ${item}`).join('\n')}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`Security / SAST Guard passed for ${files.length} source file(s).\n`);
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
