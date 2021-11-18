import log from 'loglevel';
import { loadCache } from '../helpers/cache';
import { CommandSpec } from '../model/command';
import { mint } from './mint';
import { PublicKey } from '@solana/web3.js';

const COMMAND_SPEC: CommandSpec = {
  name: 'mint_one_token',
  arguments: [],
  options: [],
  action: action,
};

async function action(
  _ignored: any,
  cmd: { opts: () => Options },
): Promise<void> {
  const { keypair, env, cacheName } = cmd.opts();
  const cacheContent = loadCache(cacheName, env);
  const configAddress = new PublicKey(cacheContent.program.config.config);
  const tx = await mint(keypair, env, configAddress);

  log.info('mint_one_token finished', tx);
}

interface Options {
  keypair: string;
  env: string;
  cacheName: string;
}

export { COMMAND_SPEC };
