import { Firestore } from '@google-cloud/firestore';

let client: Firestore | undefined;

export function isFirestoreEnabled() {
  return (process.env.DATA_STORE ?? 'local').toLowerCase() === 'firestore';
}

export function getFirestore() {
  if (!client) {
    client = new Firestore({
      projectId: process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCP_PROJECT,
    });
  }
  return client;
}
