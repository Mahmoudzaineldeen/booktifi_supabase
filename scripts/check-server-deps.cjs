#!/usr/bin/env node
/**
 * Check if server dependencies are installed
 * Exits with code 0 if installed, 1 if not
 */

const fs = require('fs');
const path = require('path');

const serverDir = path.join(__dirname, '..', 'server');
const expressPath = path.join(serverDir, 'node_modules', 'express');

try {
  fs.accessSync(expressPath);
  process.exit(0); // Dependencies exist
} catch (error) {
  process.exit(1); // Dependencies missing
}
