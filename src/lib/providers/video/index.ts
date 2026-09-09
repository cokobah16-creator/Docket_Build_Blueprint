import { dailyProvider } from './daily';
import type { VideoProvider } from './types';
export function videoProvider(): VideoProvider { return dailyProvider(); }
export type { VideoProvider } from './types';
