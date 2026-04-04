'use strict';

const fs   = require('fs');
const path = require('path');

const LOG_DIR      = path.join(__dirname, '..', 'logs');
const COMBINED_LOG = path.join(LOG_DIR, 'combined.log');
const ERROR_LOG    = path.join(LOG_DIR, 'error.log');
const MAX_LOG_BYTES = 5 * 1024 * 1024; // 5 MB — rotate beyond this

// Ensure logs directory exists
fs.mkdirSync(LOG_DIR, { recursive: true });

// ---- Rotation ---------------------------------------------------------------
// Guard: only stat() a file once per minute — not on every single write.
// This avoids a blocking disk call on every request.

const lastRotateCheck = new Map();
const ROTATE_CHECK_INTERVAL_MS = 60_000;

function rotateIfNeeded(filePath) {
  const now = Date.now();
  if (now - (lastRotateCheck.get(filePath) ?? 0) < ROTATE_CHECK_INTERVAL_MS) return;
  lastRotateCheck.set(filePath, now);
  try {
    if (fs.statSync(filePath).size >= MAX_LOG_BYTES) {
      fs.renameSync(filePath, filePath + '.old');
    }
  } catch {
    // File doesn't exist yet — nothing to rotate
  }
}

// ---- Write ------------------------------------------------------------------

function writeLine(filePath, line) {
  rotateIfNeeded(filePath);
  fs.appendFileSync(filePath, line + '\n');
}

// ---- Console formatting -----------------------------------------------------

const LEVEL_LABELS = { INFO: 'INFO ', WARN: 'WARN ', ERROR: 'ERROR' };

function consoleOutput(level, message, meta) {
  const ts    = new Date().toISOString().replace('T', ' ').slice(0, 23);
  const label = LEVEL_LABELS[level] ?? level;
  const extras = Object.keys(meta).length
    ? '  ' + Object.entries(meta).map(([k, v]) => `${k}=${v}`).join(' ')
    : '';
  const line = `[${ts}] ${label}  ${message}${extras}`;

  if (level === 'ERROR') console.error(line);
  else if (level === 'WARN')  console.warn(line);
  else                        console.log(line);
}

// ---- Core -------------------------------------------------------------------

function log(level, message, meta = {}) {
  const entry = JSON.stringify({ time: new Date().toISOString(), level, message, ...meta });

  writeLine(COMBINED_LOG, entry);
  if (level === 'ERROR') writeLine(ERROR_LOG, entry);

  consoleOutput(level, message, meta);
}

// ---- Public API -------------------------------------------------------------

module.exports = {
  info:  (message, meta) => log('INFO',  message, meta),
  warn:  (message, meta) => log('WARN',  message, meta),
  error: (message, meta) => log('ERROR', message, meta),
};
