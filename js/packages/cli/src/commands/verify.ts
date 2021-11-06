import { loadCandyProgram, loadWalletKey } from '../helpers/accounts';
import { loadCache, saveCache } from '../helpers/cache';
import { chunks, fromUTF8Array } from '../helpers/various';
import { CommandOption, CommandSpec } from '../model/command';
import { PublicKey } from '@solana/web3.js';
import * as anchor from '@project-serum/anchor';
import * as fs from 'fs';
import log from 'loglevel';
import { CONFIG_ARRAY_START, CONFIG_LINE_SIZE } from '../helpers/constants';
import { Config } from '../types';

const COMMAND_SPEC: CommandSpec = {
  name: 'verify_candy_machine',
  arguments: [],
  options: [
    CommandOption.of(
      '-r, --rpc-url <string>',
      'custom rpc url since this is a heavy command',
    ),
  ],
  action: action,
};

interface Options {
  keypair: fs.PathLike;
  env: string;
  cacheName: string;
}

async function action(
  _ignored: any,
  cmd: { opts: () => Options },
): Promise<void> {
  const { env, keypair, cacheName } = cmd.opts();

  const cacheContent = loadCache(cacheName, env);
  const walletKeyPair = loadWalletKey(keypair);
  const anchorProgram = await loadCandyProgram(walletKeyPair, env);

  const configAddress = new PublicKey(cacheContent.program.config.config);
  const config = await anchorProgram.provider.connection.getAccountInfo(
    configAddress,
  );
  let allGood = true;

  const keys = Object.keys(cacheContent.items);
  await Promise.all(
    chunks(Array.from(Array(keys.length).keys()), 500).map(
      async allIndexesInSlice => {
        for (let i = 0; i < allIndexesInSlice.length; i++) {
          const key = keys[allIndexesInSlice[i]];
          log.debug('Looking at key ', allIndexesInSlice[i]);

          const thisSlice = config.data.slice(
            CONFIG_ARRAY_START + 4 + CONFIG_LINE_SIZE * allIndexesInSlice[i],
            CONFIG_ARRAY_START +
              4 +
              CONFIG_LINE_SIZE * (allIndexesInSlice[i] + 1),
          );
          const name = fromUTF8Array([...thisSlice.slice(4, 36)]);
          const uri = fromUTF8Array([...thisSlice.slice(40, 240)]);
          const cacheItem = cacheContent.items[key];
          if (!name.match(cacheItem.name) || !uri.match(cacheItem.link)) {
            //leaving here for debugging reasons, but it's pretty useless. if the first upload fails - all others are wrong
            // log.info(
            //   `Name (${name}) or uri (${uri}) didnt match cache values of (${cacheItem.name})` +
            //   `and (${cacheItem.link}). marking to rerun for image`,
            //   key,
            // );
            cacheItem.onChain = false;
            allGood = false;
          } else {
            const json = await fetch(cacheItem.link);
            if (
              json.status == 200 ||
              json.status == 204 ||
              json.status == 202
            ) {
              const body = await json.text();
              const parsed = JSON.parse(body);
              if (parsed.image) {
                const check = await fetch(parsed.image);
                if (
                  check.status == 200 ||
                  check.status == 204 ||
                  check.status == 202
                ) {
                  const text = await check.text();
                  if (!text.match(/Not found/i)) {
                    if (text.length == 0) {
                      log.info(
                        'Name',
                        name,
                        'with',
                        uri,
                        'has zero length, failing',
                      );
                      cacheItem.link = null;
                      cacheItem.onChain = false;
                      allGood = false;
                    } else {
                      log.info('Name', name, 'with', uri, 'checked out');
                    }
                  } else {
                    log.info(
                      'Name',
                      name,
                      'with',
                      uri,
                      'never got uploaded to arweave, failing',
                    );
                    cacheItem.link = null;
                    cacheItem.onChain = false;
                    allGood = false;
                  }
                } else {
                  log.info(
                    'Name',
                    name,
                    'with',
                    uri,
                    'returned non-200 from uploader',
                    check.status,
                  );
                  cacheItem.link = null;
                  cacheItem.onChain = false;
                  allGood = false;
                }
              } else {
                log.info(
                  'Name',
                  name,
                  'with',
                  uri,
                  'lacked image in json, failing',
                );
                cacheItem.link = null;
                cacheItem.onChain = false;
                allGood = false;
              }
            } else {
              log.info('Name', name, 'with', uri, 'returned no json from link');
              cacheItem.link = null;
              cacheItem.onChain = false;
              allGood = false;
            }
          }
        }
      },
    ),
  );

  if (!allGood) {
    saveCache(cacheName, env, cacheContent);

    throw new Error(
      `not all NFTs checked out. check out logs above for details`,
    );
  }

  const configData = (await anchorProgram.account.config.fetch(
    configAddress,
  )) as Config;

  const lineCount = new anchor.BN(
    config.data.slice(247, 247 + 4),
    undefined,
    'le',
  );

  log.info(
    `uploaded (${lineCount.toNumber()}) out of (${
      configData.data.maxNumberOfLines
    })`,
  );
  if (configData.data.maxNumberOfLines > lineCount.toNumber()) {
    throw new Error(
      `predefined number of NFTs (${
        configData.data.maxNumberOfLines
      }) is smaller than the uploaded one (${lineCount.toNumber()})`,
    );
  } else {
    log.info('ready to deploy!');
  }

  saveCache(cacheName, env, cacheContent);
}

export { COMMAND_SPEC };
