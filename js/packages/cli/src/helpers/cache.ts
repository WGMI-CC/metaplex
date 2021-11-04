import path from 'path';
import { CACHE_PATH } from './constants';
import fs from 'fs';
import { ProgramConfig } from './accounts';
import { UploadItem } from '../commands/upload';
import { PublicKey } from '@solana/web3.js';

export function cachePath(
  env: string,
  cacheName: string,
  cPath: string = CACHE_PATH,
) {
  return path.join(cPath, `${env}-${cacheName}`);
}

export function loadCache(
  cacheName: string,
  env: string,
  cPath: string = CACHE_PATH,
): CacheSchema {
  const path = cachePath(env, cacheName, cPath);
  const cacheJson: CacheJson = fs.existsSync(path)
    ? JSON.parse(fs.readFileSync(path).toString())
    : undefined;
  let result: CacheSchema;
  if (cacheJson !== undefined) {
    result = {
      program: {
        config: {
          config: new PublicKey(cacheJson.program.config.config),
          uuid: cacheJson.program.config.uuid,
          txId: cacheJson.program.config.txId,
        },
        uuid: cacheJson.program.uuid,
      },
      items: cacheJson.items,
      authority: cacheJson.authority,
    };
  }
  return result;
}

export function saveCache(
  cacheName: string,
  env: string,
  cacheContent: CacheSchema,
  cPath: string = CACHE_PATH,
) {
  const cacheJson: CacheJson = {
    program: {
      config: {
        config: cacheContent.program.config.config.toString(),
        uuid: cacheContent.program.config.uuid,
        txId: cacheContent.program.config.txId,
      },
      uuid: cacheContent.program.uuid,
    },
    items: cacheContent.items,
    authority: cacheContent.authority,
    env: env,
    cacheName: cacheName,
  };
  fs.writeFileSync(cachePath(env, cacheName, cPath), JSON.stringify(cacheJson));
}

interface CacheJson {
  program: {
    config: {
      config: string;
      uuid: string;
      txId: string;
    };
    uuid: string;
  };
  items: { [itemIdnex: string]: UploadItem };
  authority: string;
  env: any;
  cacheName: string;
}

export interface CacheSchema {
  program: { config: ProgramConfig; uuid: string };
  items: { [itemIdnex: string]: UploadItem };
  authority: string;
}
