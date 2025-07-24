
import { describe, it, expect, vi, beforeEach, test } from 'vitest';
import {DefaultPeerPool} from '../src/PeerPool.js'
import { AppConfig } from '../src/ServerConfig.js';
import { TestHelper } from './TestHelper.js';
import type { ILogger } from '../src/Logger.js';
import { SignalingPeer } from '../src/SignalingPeer.js';



test('pool', () => {
    const config = new AppConfig();
    config.name = 'test';
    config.path = '/test';
    config.address_sharing = false;

    const pool = new DefaultPeerPool(config, TestHelper.logger);
    expect(pool).not.toBe(null)
})


