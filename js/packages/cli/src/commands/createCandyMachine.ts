import {
  getCandyMachineAddress,
  loadCandyProgram,
  loadWalletKey,
} from '../helpers/accounts';
import { CacheSchema, loadCache, saveCache } from '../helpers/cache';
import { parsePrice } from '../helpers/various';
import { CommandOption, CommandSpec } from '../model/command';
import { Keypair, PublicKey } from '@solana/web3.js';
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import * as anchor from '@project-serum/anchor';
import * as fs from 'fs';
import log from 'loglevel';

const COMMAND_SPEC: CommandSpec = {
  name: 'create_candy_machine',
  arguments: [],
  options: [
    CommandOption.of('-n, --number <number>', 'Number of images to upload'),
    CommandOption.of(
      '-p, --price <string>',
      'Price denominated in SOL or spl-token override',
      '1',
    ),
    CommandOption.of(
      '-t, --spl-token <string>',
      'SPL token used to price NFT mint. To use SOL leave this empty.',
    ),
    CommandOption.of(
      '-a, --spl-token-account <string>',
      'SPL token account that receives mint payments. Only required if spl-token is specified.',
    ),
    CommandOption.of(
      '-s, --sol-treasury-account <string>',
      'SOL account that receives mint payments.',
    ),
  ],
  action: action,
};

async function action(
  _ignored: any,
  cmd: { opts: () => Options },
): Promise<void> {
  const {
    keypair,
    env,
    price,
    cacheName,
    splToken,
    splTokenAccount,
    solTreasuryAccount,
  } = cmd.opts();

  let parsedPrice: number = parsePrice(price);
  const cacheContent: CacheSchema = loadCache(cacheName, env);

  const walletKeyPair: Keypair = loadWalletKey(keypair);
  const anchorProgram = await loadCandyProgram(walletKeyPair, env);

  let wallet = walletKeyPair.publicKey;
  const remainingAccounts = [];

  if (splToken || splTokenAccount) {
    if (solTreasuryAccount) {
      throw new Error(
        'If spl-token-account or spl-token is set then sol-treasury-account cannot be set',
      );
    }
    if (!splToken) {
      throw new Error(
        'If spl-token-account is set, spl-token must also be set',
      );
    }
    const splTokenKey = new PublicKey(splToken);
    const splTokenAccountKey = new PublicKey(splTokenAccount);
    if (!splTokenAccount) {
      throw new Error(
        'If spl-token is set, spl-token-account must also be set',
      );
    }

    const token = new Token(
      anchorProgram.provider.connection,
      splTokenKey,
      TOKEN_PROGRAM_ID,
      walletKeyPair,
    );

    const mintInfo = await token.getMintInfo();
    if (!mintInfo.isInitialized) {
      throw new Error(`The specified spl-token is not initialized`);
    }
    const tokenAccount = await token.getAccountInfo(splTokenAccountKey);
    if (!tokenAccount.isInitialized) {
      throw new Error(`The specified spl-token-account is not initialized`);
    }
    if (!tokenAccount.mint.equals(splTokenKey)) {
      throw new Error(
        `The spl-token-account's mint (${tokenAccount.mint.toString()}) does not match specified spl-token ${splTokenKey.toString()}`,
      );
    }

    wallet = splTokenAccountKey;
    parsedPrice = parsePrice(price, 10 ** mintInfo.decimals);
    remainingAccounts.push({
      pubkey: splTokenKey,
      isWritable: false,
      isSigner: false,
    });
  }

  if (solTreasuryAccount) {
    wallet = new PublicKey(solTreasuryAccount);
  }

  const config = cacheContent.program.config.config;
  const [candyMachine, bump] = await getCandyMachineAddress(
    config,
    cacheContent.program.uuid,
  );
  await anchorProgram.rpc.initializeCandyMachine(
    bump,
    {
      uuid: cacheContent.program.uuid,
      price: new anchor.BN(parsedPrice),
      itemsAvailable: new anchor.BN(Object.keys(cacheContent.items).length),
      goLiveDate: null,
    },
    {
      accounts: {
        candyMachine,
        wallet,
        config: config,
        authority: walletKeyPair.publicKey,
        payer: walletKeyPair.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      },
      signers: [],
      remainingAccounts,
    },
  );
  cacheContent.candyMachineAddress = candyMachine.toBase58();
  saveCache(cacheName, env, cacheContent);
  log.info(
    `create_candy_machine finished. candy machine pubkey: ${candyMachine.toBase58()}`,
  );
}

interface Options {
  keypair: fs.PathLike;
  env: string;
  price: string;
  cacheName: string;
  splToken: string;
  splTokenAccount: string;
  solTreasuryAccount: string;
}

export { COMMAND_SPEC };
