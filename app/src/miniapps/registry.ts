import { directionsMiniApp } from './directions';
import { directionsSimMiniApp } from './directions/simMiniApp';
import { spotifyMiniApp } from './spotify';
import type { MiniApp } from './types';

/** Adding a miniapp = new folder + one line here. */
export const miniApps = [spotifyMiniApp, directionsMiniApp, directionsSimMiniApp] as unknown as MiniApp[];

export const getMiniApp = (id: string): MiniApp | undefined => miniApps.find((m) => m.id === id);
