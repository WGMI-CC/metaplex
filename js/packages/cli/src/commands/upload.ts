import { EXTENSION_GIF, EXTENSION_MP3 } from '../helpers/constants';
import path from 'path';
import {
  createConfig,
  loadCandyProgram,
  loadWalletKey,
} from '../helpers/accounts';
import { PublicKey } from '@solana/web3.js';
import fs from 'fs';
import BN from 'bn.js';
import { loadCache, saveCache } from '../helpers/cache';
import log from 'loglevel';
import { arweaveUpload } from '../helpers/upload/arweave';
import { chunks } from '../helpers/various';

const IMAGE_PLACEHOLDER = "image" + EXTENSION_GIF;
const AUDIO_PLACEHOLDER = "audio" + EXTENSION_MP3;

export async function upload(
  files: string[],
  cacheName: string,
  env: string,
  keypair: string,
  totalNFTs: number,
  storage: string,
  retainAuthority: boolean,
  mutable: boolean,
): Promise<boolean> {
  let uploadSuccessful = true;

  const savedContent = loadCache(cacheName, env);
  const cacheContent = savedContent || {};

  if (!cacheContent.program) {
    cacheContent.program = {};
  }

  let existingInCache = [];
  if (!cacheContent.items) {
    cacheContent.items = {};
  } else {
    existingInCache = Object.keys(cacheContent.items);
  }

  const seenImage = {};
  const seenAudio = {};
  const newImageFiles = [];
  const newAudioFiles = [];

  files.forEach(f => {
    if (f.endsWith(EXTENSION_GIF)) {
        if (!seenImage[f.replace(EXTENSION_GIF, '').split('/').pop()]) {
          seenImage[f.replace(EXTENSION_GIF, '').split('/').pop()] = true;
          newImageFiles.push(f);
        }
    } else if (f.endsWith(EXTENSION_MP3)) {
        if (!seenAudio[f.replace(EXTENSION_MP3, '').split('/').pop()]) {
            seenAudio[f.replace(EXTENSION_MP3, '').split('/').pop()] = true;
            newAudioFiles.push(f);
          }
    }
  });

  existingInCache.forEach(f => {
    if (f.endsWith(EXTENSION_GIF)) {
        if (!seenImage[f]) {
        seenImage[f] = true;
        newImageFiles.push(f + EXTENSION_GIF);
        }
    } else if (f.endsWith(EXTENSION_MP3)) {
        if (!seenAudio[f]) {
            seenAudio[f] = true;
            newAudioFiles.push(f + EXTENSION_MP3);
        }
    }
  });

  const images = newImageFiles.filter(val => path.extname(val) === EXTENSION_GIF);
  const IMAGES_SIZE = images.length;

  const audioFiles = newImageFiles.filter(val => path.extname(val) === EXTENSION_MP3);
  const AUDIO_SIZE = images.length;

  if (IMAGES_SIZE !== AUDIO_SIZE) throw new Error('Number of images and audio files must match.');

  const walletKeyPair = loadWalletKey(keypair);
  const anchorProgram = await loadCandyProgram(walletKeyPair, env);

  let config = cacheContent.program.config
    ? new PublicKey(cacheContent.program.config)
    : undefined;

  for (let i = 0; i < IMAGES_SIZE; i++) {
    const image = images[i];
    const imageName = path.basename(image);
    const imageIndex = imageName.replace(EXTENSION_GIF, '');
    
    const audioName = imageName.replace(EXTENSION_GIF, EXTENSION_MP3);
    const audio = audioFiles.find(val => path.basename(val).startsWith(imageIndex));
    if (audio === undefined) throw new Error(`Missing audio file to match ${imageName}`);
    const audioIndex = imageIndex;
     
    log.debug(`Processing file: ${i}`);
    if (i % 50 === 0) {
      log.info(`Processing file: ${i}`);
    }

    let contentData = cacheContent?.items?.[imageIndex];
    let link: string;
    let files: {file: fs.PathLike, format: string, filename: string}[];
    if (contentData) {
        link = contentData.link;
        files = contentData.files;
    }
    if (!link || !files || !cacheContent.program.uuid) {
      const manifestPath = image.replace(EXTENSION_GIF, '.json');
      const manifestContent = fs
        .readFileSync(manifestPath)
        .toString()
        .replace(imageName, IMAGE_PLACEHOLDER)
        .replace(imageName, IMAGE_PLACEHOLDER)
        .replace(audioName, AUDIO_PLACEHOLDER)
        .replace(audioName, AUDIO_PLACEHOLDER);
      const manifest = JSON.parse(manifestContent);

      const manifestBuffer = Buffer.from(JSON.stringify(manifest));

      if (i === 0 && !cacheContent.program.uuid) {
        // initialize config
        log.info(`initializing config`);
        try {
          const res = await createConfig(anchorProgram, walletKeyPair, {
            maxNumberOfLines: new BN(totalNFTs),
            symbol: manifest.symbol,
            sellerFeeBasisPoints: manifest.seller_fee_basis_points,
            isMutable: mutable,
            maxSupply: new BN(0),
            retainAuthority: retainAuthority,
            creators: manifest.properties.creators.map(creator => {
              return {
                address: new PublicKey(creator.address),
                verified: true,
                share: creator.share,
              };
            }),
          });
          cacheContent.program.uuid = res.uuid;
          cacheContent.program.config = res.config.toBase58();
          config = res.config;

          log.info(
            `initialized config for a candy machine with publickey: ${res.config.toBase58()}`,
          );

          saveCache(cacheName, env, cacheContent);
        } catch (exx) {
          log.error('Error deploying config to Solana network.', exx);
          throw exx;
        }
      }

      if (!link) {
        try {
          if (storage === 'arweave') {
            files = [
                {file: image, format: 'image/gif', filename: IMAGE_PLACEHOLDER},
                {file: audio, format: 'audio/mp3', filename: AUDIO_PLACEHOLDER},
            ]
            link = await arweaveUpload(
                walletKeyPair,
                anchorProgram,
                env,
                files,
                manifestBuffer,
                manifest,
                imageIndex,
            );
          }

          if (link) {
            log.debug('setting cache for ', imageIndex);
            cacheContent.items[imageIndex] = {
                link: link,
                files: files,
                name: manifest.name,
                onChain: false,
            };
            cacheContent.authority = walletKeyPair.publicKey.toBase58();
            saveCache(cacheName, env, cacheContent);
          }
        } catch (er) {
          uploadSuccessful = false;
          log.error(`Error uploading file ${imageIndex}`, er);
        }
      }
    }
  }

  const keys = Object.keys(cacheContent.items);
  try {
    await Promise.all(
      chunks(Array.from(Array(keys.length).keys()), 1000).map(
        async allIndexesInSlice => {
          for (
            let offset = 0;
            offset < allIndexesInSlice.length;
            offset += 10
          ) {
            const indexes = allIndexesInSlice.slice(offset, offset + 10);
            const onChain = indexes.filter(i => {
              const index = keys[i];
              return cacheContent.items[index]?.onChain || false;
            });
            const ind = keys[indexes[0]];

            if (onChain.length != indexes.length) {
              log.info(
                `Writing indices ${ind}-${keys[indexes[indexes.length - 1]]}`,
              );
              try {
                await anchorProgram.rpc.addConfigLines(
                  ind,
                  indexes.map(i => ({
                    uri: cacheContent.items[keys[i]].link,
                    name: cacheContent.items[keys[i]].name,
                  })),
                  {
                    accounts: {
                      config,
                      authority: walletKeyPair.publicKey,
                    },
                    signers: [walletKeyPair],
                  },
                );
                indexes.forEach(i => {
                  cacheContent.items[keys[i]] = {
                    ...cacheContent.items[keys[i]],
                    onChain: true,
                  };
                });
                saveCache(cacheName, env, cacheContent);
              } catch (e) {
                log.error(
                  `saving config line ${ind}-${
                    keys[indexes[indexes.length - 1]]
                  } failed`,
                  e,
                );
                uploadSuccessful = false;
              }
            }
          }
        },
      ),
    );
  } catch (e) {
    log.error(e);
  } finally {
    saveCache(cacheName, env, cacheContent);
  }
  console.log(`Done. Successful = ${uploadSuccessful}.`);
  return uploadSuccessful;
}
