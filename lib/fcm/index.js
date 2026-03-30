/**
 * Firebase Cloud Messaging (FCM) Module
 *
 * Initializes Firebase Admin SDK for sending push notifications to Android devices.
 * Used primarily for remote wake-up functionality when devices go offline.
 */

import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { cert } from 'firebase-admin/app';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Initialize Firebase Admin SDK with service account credentials.
 * Uses getApps() to check if already initialized to prevent duplicate initialization.
 */
export function initializeFirebase() {
  try {
    // Check if any Firebase app is already initialized
    const apps = getApps();
    if (apps.length > 0) {
      console.log('[FCM] Firebase app already initialized, returning existing instance');
      return apps[0]; // Return the default app
    }

    // Get service account key path from environment variable
    const serviceAccountPath = process.env.FCM_SERVICE_ACCOUNT_KEY;

    if (!serviceAccountPath) {
      console.warn('[FCM] FCM_SERVICE_ACCOUNT_KEY not set - FCM functionality disabled');
      return null;
    }

    // Read service account key
    const serviceAccount = JSON.parse(
      readFileSync(serviceAccountPath, 'utf8')
    );

    // Initialize Firebase app
    const firebaseApp = initializeApp({
      credential: cert(serviceAccount)
    });

    console.log('[FCM] Firebase Admin SDK initialized successfully');
    return firebaseApp;

  } catch (error) {
    console.error('[FCM] Failed to initialize Firebase Admin SDK:', error);
    return null;
  }
}

/**
 * Get the Firebase app instance.
 * Initializes if not already initialized.
 */
export function getFirebaseApp() {
  const apps = getApps();
  if (apps.length > 0) {
    return apps[0];
  }
  return initializeFirebase();
}

/**
 * Check if FCM is properly initialized and ready to send messages.
 */
export function isFcmReady() {
  return getApps().length > 0;
}

export default {
  initializeFirebase,
  getFirebaseApp,
  isFcmReady
};
