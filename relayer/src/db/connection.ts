import mongoose from 'mongoose';
import { config } from '../config';

let isConnected = false;

export async function connectDB(): Promise<void> {
  if (isConnected) return;

  await mongoose.connect(config.MONGODB_URI, {
    dbName: config.MONGODB_DB_NAME,
    serverSelectionTimeoutMS: 10_000,
  });

  isConnected = true;
  console.log(`[DB] Connected to MongoDB (${config.MONGODB_DB_NAME})`);

  mongoose.connection.on('disconnected', () => {
    isConnected = false;
    console.warn('[DB] MongoDB disconnected');
  });
}

export function getConnectionStatus(): string {
  const states: Record<number, string> = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  };
  return states[mongoose.connection.readyState] ?? 'unknown';
}
