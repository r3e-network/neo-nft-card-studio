const { execSync } = require('child_process');
const path = require('path');
try {
  const result = execSync('npm run build --workspaces --if-present', { encoding: 'utf-8', cwd: path.resolve(__dirname) });
  console.log('Build output:', result);
} catch (error) {
  console.error('Build failed:', error.stdout, error.stderr);
  process.exitCode = 1;
}
