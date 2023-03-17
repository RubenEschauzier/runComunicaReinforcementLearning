/// <reference types="node" />
import type { Writable } from 'stream';
export declare function createEndPoint(stdout: Writable, stderr: Writable, exit: (code: number) => void): Promise<void>;
