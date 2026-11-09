const { ESLint } = require('eslint');

async function main() {
  const eslint = new ESLint();
  const results = await eslint.lintFiles(['src/**/*.js', 'tests/**/*.js']);
  const formatter = await eslint.loadFormatter('stylish');
  const output = formatter.format(results);
  if (output) {
    process.stdout.write(output);
  }
  const errors = results.reduce((total, result) => total + result.errorCount, 0);
  const warnings = results.reduce((total, result) => total + result.warningCount, 0);
  if (errors > 0) {
    process.stderr.write(`Lint failed with ${errors} error(s) and ${warnings} warning(s).\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`Lint passed for ${results.length} file(s).\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
