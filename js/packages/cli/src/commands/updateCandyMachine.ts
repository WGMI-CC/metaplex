import log from 'loglevel';
import { loadWalletKey, loadCandyProgram } from '../helpers/accounts';
import { loadCache, saveCache } from '../helpers/cache';
import { parseDate, parsePrice } from '../helpers/various';
import { CommandOption, CommandSpec } from '../model/command';
import * as anchor from '@project-serum/anchor';
import * as fs from 'fs';
import { PublicKey } from '@solana/web3.js';

const COMMAND_SPEC: CommandSpec = {
  name: 'update_candy_machine',
  arguments: [],
  options: [
    CommandOption.of(
      '-d, --date <string>',
      'timestamp - eg "04 Dec 1995 00:12:00 GMT" or "now"',
    ),
    CommandOption.of('-p, --price <string>', 'SOL price'),
  ],
  action: action,
};

async function action(
  _ignored: any,
  cmd: { opts: () => Options },
): Promise<void> {
  const { keypair, env, date, price, cacheName } = cmd.opts();

  const cacheContent = loadCache(cacheName, env);

  const secondsSinceEpoch = date ? parseDate(date) : null;
  const lamports = price ? parsePrice(price) : null;

  const walletKeyPair = loadWalletKey(keypair);
  const anchorProgram = await loadCandyProgram(walletKeyPair, env);

  const candyMachine = new PublicKey(cacheContent.candyMachineAddress);
  const tx = await anchorProgram.rpc.updateCandyMachine(
    lamports ? new anchor.BN(lamports) : null,
    secondsSinceEpoch ? new anchor.BN(secondsSinceEpoch) : null,
    {
      accounts: {
        candyMachine,
        authority: walletKeyPair.publicKey,
      },
    },
  );

  cacheContent.startDate = secondsSinceEpoch;
  saveCache(cacheName, env, cacheContent);
  if (date)
    log.info(` - updated startDate timestamp: ${secondsSinceEpoch} (${date})`);
  if (lamports)
    log.info(` - updated price: ${lamports} lamports (${price} SOL)`);
  log.info('update_candy_machine finished', tx);
}

interface Options {
  keypair: fs.PathLike;
  env: string;
  date: string;
  price: string;
  cacheName: string;
}

export { COMMAND_SPEC };
