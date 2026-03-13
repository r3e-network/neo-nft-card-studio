const { execSync } = require('child_process');
try {
  const result = execSync('npm run build --workspaces --if-present', { encoding: 'utf-8' });
  console.log('Build output:', result);
} catch (error) {
  console.error('Build failed:', error.stdout, error.stderr);
}
