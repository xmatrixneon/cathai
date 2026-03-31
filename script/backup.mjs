#!/usr/bin/env node
/**
 * CattySMS Backup Script
 *
 * Creates backups of:
 * - MongoDB database
 * - Nginx configurations
 * - Stubs API files
 *
 * Usage: node script/backup.mjs
 */

import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, copyFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = dirname(__dirname);
const BACKUPS_DIR = join(PROJECT_ROOT, 'backups');

// Get timestamp for backup folder
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backupId = `smsgateway_${timestamp}`;

console.log(`\n🔄 Starting backup: ${backupId}`);
console.log('=' .repeat(50));

// Create backup directories
const dbBackupDir = join(BACKUPS_DIR, 'database', backupId);
const nginxBackupDir = join(BACKUPS_DIR, 'nginx');
const stubsBackupDir = join(BACKUPS_DIR, 'stubs');

mkdirSync(dbBackupDir, { recursive: true });
mkdirSync(nginxBackupDir, { recursive: true });
mkdirSync(stubsBackupDir, { recursive: true });

// Parse MongoDB URI from .env
let dbUser, dbPass, dbHost, dbPort, dbName;
try {
  const envContent = require('fs').readFileSync(join(PROJECT_ROOT, '.env'), 'utf-8');
  const mongoUri = envContent.match(/MONGODB_URI=(.+)/)?.[1];

  if (mongoUri) {
    const uri = mongoUri.replace('mongodb://', '').replace(/\?.*/, '');
    const [authPart, hostPart] = uri.split('@');
    [dbUser, dbPass] = authPart.split(':');
    dbPass = decodeURIComponent(dbPass);
    [dbHost, dbPort] = hostPart.split(':');
    dbName = mongoUri.match(/\/([^\?]+)/)?.[1];
  }
} catch (e) {
  console.warn('⚠️  Could not parse .env file, using defaults');
  dbUser = 'smsgateway';
  dbPass = 'Trainman@843411';
  dbHost = 'localhost';
  dbPort = '27017';
  dbName = 'smsgateway';
}

console.log(`📦 Database: ${dbName} @ ${dbHost}:${dbPort}`);

/**
 * Backup MongoDB database using mongodump
 */
function backupDatabase() {
  console.log('\n📊 Backing up MongoDB database...');

  try {
    const cmd = `mongodump --uri="mongodb://${dbUser}:${encodeURIComponent(dbPass)}@${dbHost}:${dbPort}/${dbName}?authSource=${dbName}" --out="${dbBackupDir}"`;
    execSync(cmd, { stdio: 'inherit' });
    console.log(`✅ Database backup completed: ${dbBackupDir}`);
  } catch (error) {
    console.error('❌ Database backup failed:', error.message);
    throw error;
  }
}

/**
 * Backup Nginx configurations
 */
function backupNginx() {
  console.log('\n🌐 Backing up Nginx configurations...');

  const nginxConfigs = [
    { src: '/etc/nginx/nginx.conf', dest: 'nginx.conf' },
    { src: '/etc/nginx/sites-available/api.cattysms.shop', dest: 'api.cattysms.shop.conf' },
    { src: '/etc/nginx/sites-available/cattysms.shop', dest: 'cattysms.shop.conf' },
    { src: '/etc/nginx/sites-available/default', dest: 'default.conf' },
  ];

  // Also backup SSL params if they exist
  const sslConfigs = [
    { src: '/etc/letsencrypt/options-ssl-nginx.conf', dest: 'options-ssl-nginx.conf' },
    { src: '/etc/letsencrypt/ssl-dhparams.pem', dest: 'ssl-dhparams.pem' },
  ];

  // Check if certbot files exist, and if so add to backup list
  for (const config of sslConfigs) {
    if (existsSync(config.src)) {
      nginxConfigs.push(config);
    }
  }

  for (const config of nginxConfigs) {
    if (existsSync(config.src)) {
      copyFileSync(config.src, join(nginxBackupDir, config.dest));
      console.log(`  ✅ Backed up: ${config.dest}`);
    } else {
      console.log(`  ⚠️  Skipped (not found): ${config.src}`);
    }
  }

  // Create timestamp marker
  writeFileSync(join(nginxBackupDir, 'last_backup.txt'), timestamp);
  console.log(`✅ Nginx backup completed: ${nginxBackupDir}`);
}

/**
 * Backup Stubs API files
 */
function backupStubs() {
  console.log('\n📝 Backing up Stubs API files...');

  const stubsDir = '/var/www/html/stubs';
  const filesToBackup = [
    'handler_api.php',
    'handler_api.php.bak',
    '2handler_api.php',
    'composer.json',
    'composer.lock',
    't.php',
  ];

  for (const file of filesToBackup) {
    const srcPath = join(stubsDir, file);
    if (existsSync(srcPath)) {
      copyFileSync(srcPath, join(stubsBackupDir, file));
      console.log(`  ✅ Backed up: ${file}`);
    } else {
      console.log(`  ⚠️  Skipped (not found): ${file}`);
    }
  }

  // Create .gitignore to prevent committing backups
  writeFileSync(join(stubsBackupDir, '.gitignore'), '*\n');
  console.log(`✅ Stubs backup completed: ${stubsBackupDir}`);
}

/**
 * Clean old database backups (keep last 5)
 */
function cleanOldBackups() {
  console.log('\n🧹 Cleaning old database backups...');

  const dbDir = join(BACKUPS_DIR, 'database');
  const backups = readdirSync(dbDir)
    .filter(name => name.startsWith('smsgateway_'))
    .map(name => ({
      name,
      path: join(dbDir, name),
      time: statSync(join(dbDir, name)).mtime.getTime(),
    }))
    .sort((a, b) => b.time - a.time);

  if (backups.length > 5) {
    const toDelete = backups.slice(5);
    for (const backup of toDelete) {
      execSync(`rm -rf "${backup.path}"`, { stdio: 'inherit' });
      console.log(`  🗑️  Removed old backup: ${backup.name}`);
    }
  }

  console.log(`✅ Kept ${Math.min(backups.length, 5)} most recent backups`);
}

/**
 * Generate backup summary
 */
function generateSummary() {
  console.log('\n📋 Backup Summary:');
  console.log('=' .repeat(50));
  console.log(`  Backup ID:    ${backupId}`);
  console.log(`  Timestamp:    ${new Date().toISOString()}`);
  console.log(`  Database:     ${dbBackupDir}`);
  console.log(`  Nginx:        ${nginxBackupDir}`);
  console.log(`  Stubs:        ${stubsBackupDir}`);

  // Calculate sizes
  const getDirSize = (dir) => {
    let size = 0;
    const files = readdirSync(dir, { withFileTypes: true });
    for (const file of files) {
      const path = join(dir, file.name);
      if (file.isDirectory()) {
        size += getDirSize(path);
      } else {
        size += statSync(path).size;
      }
    }
    return size;
  };

  const dbSize = (getDirSize(dbBackupDir) / 1024 / 1024).toFixed(2);
  console.log(`  DB Size:      ${dbSize} MB`);
  console.log('=' .repeat(50));
}

// Run backup
try {
  backupDatabase();
  backupNginx();
  backupStubs();
  cleanOldBackups();
  generateSummary();

  console.log('\n✅ Backup completed successfully!\n');
} catch (error) {
  console.error('\n❌ Backup failed:', error.message);
  process.exit(1);
}
