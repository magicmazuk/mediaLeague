import { next } from '@vercel/functions';
import { gate } from './backend/gate.js';

/** Vercel Routing Middleware: every request passes the password gate before reaching the app or the API. */
export default async function middleware(request: Request) {
  return (await gate(request)) ?? next();
}

export const config = { runtime: 'nodejs' };
