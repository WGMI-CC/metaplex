import { FILE_SPECS } from '../helpers/constants';
import path from 'path';
import {
  ProgramConfig,
  CreateConfigInput,
  createConfig as createProgramConfig,
  loadCandyProgram,
  loadWalletKey,
} from '../helpers/accounts';
import { PublicKey, Keypair } from '@solana/web3.js';
import fs from 'fs';
import BN from 'bn.js';
import { CacheSchema, loadCache, saveCache } from '../helpers/cache';
import log from 'loglevel';
import { ArweaveFilePayload, arweaveUpload } from '../helpers/upload/arweave';
import { chunks } from '../helpers/various';
import { CommandArgument, CommandOption, CommandSpec } from '../model/command';
import { FileSpec } from '../model/files';
import { Creator } from '../types';
import * as anchor from '@project-serum/anchor';

const COMMAND_SPEC: CommandSpec = {
  name: 'upload',
  arguments: [
    CommandArgument.of(
      '<directory>',
      'Directory containing images named from 0-n',
      val => fs.readdirSync(`${val}`).map(file => path.join(val, file)),
    ),
  ],
  options: [
    CommandOption.of('-n, --number <number>', 'Number of images to upload'),
    CommandOption.of(
      '-s, --storage <string>',
      'Database to use for storage (arweave, ipfs, aws)',
      'arweave',
    ),
    CommandOption.of(
      '--ipfs-infura-project-id <string>',
      'Infura IPFS project id (required if using IPFS)',
    ),
    CommandOption.of(
      '--ipfs-infura-secret <string>',
      'Infura IPFS scret key (required if using IPFS)',
    ),
    CommandOption.of(
      '--aws-s3-bucket <string>',
      '(existing) AWS S3 Bucket name (required if using aws)',
    ),
    CommandOption.of(
      '--no-retain-authority',
      'Do not retain authority to update metadata',
    ),
    CommandOption.of('--no-mutable', 'Metadata will not be editable'),
  ],
  action: uploadAction,
};

type StorageType = 'ipfs' | 'aws' | 'arweave';

interface Options {
  number: number;
  keypair: string;
  env: string;
  cacheName: string;
  storage: StorageType;
  ipfsInfuraProjectId: string;
  ipfsInfuraSecret: string;
  awsS3Bucket: string;
  retainAuthority: boolean;
  mutable: boolean;
}

interface MediaSpec {
  path: string;
  spec: FileSpec;
}

interface FileSet {
  index: string;
  manifest: string;
  media: MediaSpec[];
}

async function uploadAction(
  files: string[],
  _ignored: any,
  cmd: { opts: () => Options },
): Promise<void> {
  const {
    keypair,
    env,
    cacheName,
    storage,
    ipfsInfuraProjectId,
    ipfsInfuraSecret,
    awsS3Bucket,
    retainAuthority,
    mutable,
  } = cmd.opts();

  if (storage === 'ipfs' && (!ipfsInfuraProjectId || !ipfsInfuraSecret)) {
    throw new Error(
      'IPFS selected as storage option but Infura project id or secret key were not provided.',
    );
  }

  if (storage === 'aws' && !awsS3Bucket) {
    throw new Error(
      'aws selected as storage option but existing bucket name (--aws-s3-bucket) not provided.',
    );
  }

  //TODO re-add- IPFS storage option
  //TODO re-add- IPFS storage option
  //TODO re-add- IPFS storage option
  //TODO re-add- IPFS storage option
  //TODO re-add- IPFS storage option
  //TODO re-add- IPFS storage option
  // const ipfsCredentials = {
  //     projectId: ipfsInfuraProjectId,
  //     secretKey: ipfsInfuraSecret,
  // };

  const organizedFiles: FileSet[] = organizeFiles(files);
  const nftCount: number = organizedFiles.length;

  log.info(`Beginning the upload for ${nftCount} file sets`);

  const startMs = Date.now();
  log.info('started at: ' + startMs.toString());
  let warn = false;
  // keep trying to upload files until we get all of them
  let attempts = 0;
  while (attempts < 100) {
    const successful: boolean = await UploadTask.with(
      organizedFiles,
      cacheName,
      env,
      keypair,
      nftCount,
      storage,
      retainAuthority,
      mutable,
    ).upload();
    if (successful) {
      warn = false;
      break;
    } else {
      warn = true;
      log.warn('upload was not successful, rerunning');
      attempts += 1;
    }
  }
  const endMs = Date.now();
  const timeTaken = new Date(endMs - startMs).toISOString().substr(11, 8);
  log.info(
    `ended at: ${new Date(endMs).toISOString()}. time taken: ${timeTaken}`,
  );
  if (warn) {
    log.info('not all media files have been uploaded, rerun this step.');
  }
}

// splits files by their index and by metadata vs media files
function organizeFiles(files: string[]): FileSet[] {
  const split: SplitArrayResult<string> = splitArrayByPredicate(files, f =>
    f.endsWith(FILE_SPECS.json.extension),
  );
  let nonManifestPaths: string[] = split.failed;
  const manifestPaths: string[] = split.passed;
  const seenIndices: string[] = [];
  const result: FileSet[] = [];
  for (const manifestPath of manifestPaths) {
    const manifestFileName: string = path.basename(manifestPath);
    const fileSetIndex: string = manifestFileName.substr(
      0,
      manifestFileName.length - FILE_SPECS.json.extension.length,
    );
    if (seenIndices.includes(fileSetIndex)) {
      throw new Error(
        `Duplicate metadata JSON indices ${fileSetIndex} included in files.`,
      );
    }
    const split: SplitArrayResult<string> = splitArrayByPredicate(
      nonManifestPaths,
      f => path.basename(f, path.extname(f)) === fileSetIndex,
    );
    let mediaPaths: string[] = split.passed;
    const remainingNonManifests: string[] = split.failed;
    const mediaSpecs: MediaSpec[] = [];
    for (const fileSpec of Object.values(FILE_SPECS)) {
      const { passed: specFiles, failed: remainingMediaPaths } =
        splitArrayByPredicate(mediaPaths, f => f.endsWith(fileSpec.extension));
      mediaPaths = remainingMediaPaths;
      for (const specFile of specFiles) {
        mediaSpecs.push({ path: specFile, spec: fileSpec });
      }
    }
    nonManifestPaths = remainingNonManifests;
    const fileSet: FileSet = {
      index: fileSetIndex,
      manifest: manifestPath,
      media: mediaSpecs,
    };
    result.push(fileSet);
  }
  return result;
}

interface SplitArrayResult<T> {
  passed: T[];
  failed: T[];
}

function splitArrayByPredicate<T>(
  array: T[],
  predicate: (element: T) => boolean,
): SplitArrayResult<T> {
  const result: SplitArrayResult<T> = { passed: [], failed: [] };
  for (const element of array) {
    if (predicate(element)) result.passed.push(element);
    else result.failed.push(element);
  }
  return result;
}

// checks that the files referenced in the metadata template are present in the media file list
async function validateFileSet(fileSet: FileSet): Promise<void> {
  const { manifest: metadata, media } = fileSet;
  fs.readFile(
    metadata,
    undefined,
    (err: NodeJS.ErrnoException, data: Buffer) => {
      if (err) throw err;
      const mediaExtensions: string[] = media.map(f => path.extname(f.path));
      const fileSpecs: FileSpec[] = Object.values(FILE_SPECS);
      const fileContents: string = data.toString();
      for (const fileSpec of fileSpecs) {
        if (
          fileContents.includes(fileSpec.placeholder) &&
          !mediaExtensions.includes(fileSpec.extension)
        ) {
          throw new Error(
            `Metadata ${metadata} includes a placeholder ${fileSpec.placeholder} that isnt present in the file list.`,
          );
        }
      }
    },
  );
}

export interface UploadItem {
  link?: string;
  files?: FileSet;
  name?: string;
  onChain?: boolean;
}

interface Manifest {
  name: string;
  properties: {
    creators: Creator[];
  };
  symbol: string;
  seller_fee_basis_points: number;
}

class UploadTask {
  private files: FileSet[];
  private cacheName: string;
  private env: string;
  private walletKeyPair: Keypair;
  private totalNFTs: number;
  private storage: StorageType;
  private retainAuthority: boolean;
  private mutable: boolean;

  private success: boolean;

  private constructor(
    files: FileSet[],
    cacheName: string,
    env: string,
    walletKeyPair: Keypair,
    totalNFTs: number,
    storage: StorageType,
    retainAuthority: boolean,
    mutable: boolean,
  ) {
    this.files = files;
    this.cacheName = cacheName;
    this.env = env;
    this.walletKeyPair = walletKeyPair;
    this.totalNFTs = totalNFTs;
    this.storage = storage;
    this.retainAuthority = retainAuthority;
    this.mutable = mutable;
  }

  public static with(
    files: FileSet[],
    cacheName: string,
    env: string,
    keypairFile: fs.PathLike,
    totalNFTs: number,
    storage: StorageType,
    retainAuthority: boolean,
    mutable: boolean,
  ): UploadTask {
    const walletKeyPair: Keypair = loadWalletKey(keypairFile);
    return new UploadTask(
      files,
      cacheName,
      env,
      walletKeyPair,
      totalNFTs,
      storage,
      retainAuthority,
      mutable,
    );
  }

  async upload(): Promise<boolean> {
    this.success = true;
    await Promise.all(this.files.map(s => validateFileSet(s)));

    const savedContent: CacheSchema = loadCache(this.cacheName, this.env);
    const cacheContent: CacheSchema = savedContent || {
      program: { config: undefined, uuid: undefined },
      items: {},
      authority: undefined,
      candyMachineAddress: undefined,
      startDate: undefined,
    };
    const existingInCache: string[] = Object.keys(cacheContent.items);

    // to be honest I dont really understand what this accomplishes <3 Austin Milt
    const newItems: UploadItem[] = this.findItemsThatNeedProcessing(
      existingInCache,
      cacheContent,
    );
    const anchorProgram: anchor.Program = await loadCandyProgram(
      this.walletKeyPair,
      this.env,
    );

    let config: ProgramConfig = cacheContent.program.config
      ? {
          config: new PublicKey(cacheContent.program.config.config),
          uuid: cacheContent.program.config.uuid,
          txId: cacheContent.program.config.txId,
        }
      : undefined;

    for (let i = 0; i < newItems.length; i++) {
      log.info(`Processing fileset: ${i}`);

      const item: UploadItem = newItems[i];
      const itemIndex: string = item.files.index;

      const contentData = cacheContent.items[itemIndex];
      let link: string;
      let files: FileSet;
      if (contentData) {
        link = contentData.link;
        files = contentData.files;
      }
      if (!link || !files || !cacheContent.program.uuid) {
        const manifestPath: string = item.files.manifest;
        const manifestContent: string = fs
          .readFileSync(manifestPath)
          .toString();
        for (const mediaSpec of item.files.media) {
          while (manifestContent.includes(mediaSpec.path))
            manifestContent.replace(mediaSpec.path, mediaSpec.spec.placeholder);
        }

        const manifest: Manifest = JSON.parse(manifestContent) as Manifest;
        const manifestBuffer = Buffer.from(JSON.stringify(manifest));

        // if we havent already done so, create the program config for the candy machine
        if (i === 0) {
          if (
            !cacheContent ||
            !cacheContent.program ||
            !cacheContent.program.config ||
            !cacheContent.program.config.uuid
          ) {
            log.info(`initializing config`);
            config = await this.initializeProgramConfig(
              manifest,
              cacheContent,
              anchorProgram,
            );
            log.info(
              `initialized config for a candy machine with publickey: ${config.config.toBase58()}`,
            );
          } else {
            log.info(
              'reusing existing candy machine with publickey: ' +
                cacheContent.program.config.config.toBase58(),
            );
          }
        }

        // if we havent already done so, upload media files and get the storage address/info
        if (!link) {
          try {
            link = await this.uploadMediaFiles(
              item,
              manifestBuffer,
              manifest,
              itemIndex,
              anchorProgram,
              cacheContent,
              files,
            );
          } catch (error: unknown) {
            try {
              const errorCast: UploadError = error as UploadError;
              log.error(`Error uploading file ${itemIndex}`, errorCast.cause);
            } catch (ee) {
              log.error('Unknown error during upload. ' + error.toString());
            }
            this.success = false;
          }
        }
      }
    }

    const keys = Object.keys(cacheContent.items);
    try {
      // break the files to be processed by anchor into slices/chunks, and work on each chunk separately
      const indexNumberChunks: number[][] = chunks(
        Array.from(Array(keys.length).keys()),
        1000,
      );
      await Promise.all(
        indexNumberChunks.map((allIndexNumbersInChunk: number[]) =>
          this.updateAnchorConfigForChunk(
            allIndexNumbersInChunk,
            cacheContent,
            keys,
            anchorProgram,
            config,
          ),
        ),
      );
    } catch (e) {
      log.error(e);
    } finally {
      saveCache(this.cacheName, this.env, cacheContent);
    }
    log.info(`Done. Successful = ${this.success}.`);
    return this.success;
  }

  private findItemsThatNeedProcessing(
    existingInCache: string[],
    cacheContent: CacheSchema,
  ): UploadItem[] {
    const seenItems: string[] = [];
    const newItems: UploadItem[] = [];
    for (const fileSet of this.files) {
      if (!seenItems[fileSet.index]) {
        seenItems[fileSet.index] = true;
        newItems.push({ files: fileSet });
      }
    }

    for (const itemIndex of existingInCache) {
      if (!seenItems[itemIndex]) {
        seenItems[itemIndex] = true;
        newItems.push(cacheContent[itemIndex]);
      }
    }
    return newItems;
  }

  private async initializeProgramConfig(
    manifest: Manifest,
    cacheContent: CacheSchema,
    anchorProgram: anchor.Program,
  ): Promise<ProgramConfig> {
    try {
      const createConfigInput: CreateConfigInput = {
        maxNumberOfLines: new BN(this.totalNFTs),
        symbol: manifest.symbol,
        sellerFeeBasisPoints: manifest.seller_fee_basis_points,
        isMutable: this.mutable,
        maxSupply: new BN(0),
        retainAuthority: this.retainAuthority,
        creators: manifest.properties.creators.map(creator => {
          return {
            address: new PublicKey(creator.address),
            verified: true,
            share: creator.share,
          };
        }),
      };
      const res: ProgramConfig = await createProgramConfig(
        anchorProgram,
        this.walletKeyPair,
        createConfigInput,
      );
      cacheContent.program.config = {
        config: res.config,
        uuid: res.uuid,
        txId: undefined,
      };
      cacheContent.program.uuid = res.uuid;

      saveCache(this.cacheName, this.env, cacheContent);
      return cacheContent.program.config;
    } catch (error) {
      log.error('Error deploying config to Solana network.', error);
      throw error;
    }
  }

  private async uploadMediaFiles(
    item: UploadItem,
    manifestBuffer: Buffer,
    manifest: Manifest,
    itemIndex: string,
    anchorProgram: anchor.Program,
    cacheContent: CacheSchema,
    files: FileSet,
  ): Promise<string> {
    try {
      let link: string;
      if (this.storage === 'arweave') {
        const arweaveFiles: ArweaveFilePayload[] = item.files.media.map(f => ({
          file: f.path,
          format: f.spec.format,
          filename: f.spec.placeholder,
        }));
        link = await arweaveUpload(
          this.walletKeyPair,
          anchorProgram,
          this.env,
          arweaveFiles,
          manifestBuffer,
          manifest,
          itemIndex,
        );
      }

      if (link) {
        log.debug('setting cache for ', itemIndex);
        cacheContent.items[itemIndex] = {
          link: link,
          files: files,
          name: manifest.name,
          onChain: false,
        };
        cacheContent.authority = this.walletKeyPair.publicKey.toBase58();
        saveCache(this.cacheName, this.env, cacheContent);
      }

      return link;
    } catch (error) {
      throw new UploadError(`Error uploading file ${itemIndex}`, error);
    }
  }

  private async updateAnchorConfigForChunk(
    allIndexNumbersInChunk: number[],
    cacheContent: CacheSchema,
    keys: string[],
    anchorProgram: anchor.Program,
    programConfig: ProgramConfig,
  ): Promise<void> {
    for (let offset = 0; offset < allIndexNumbersInChunk.length; offset += 10) {
      const indexNumbers: number[] = allIndexNumbersInChunk.slice(
        offset,
        offset + 10,
      );
      const onChain: number[] = indexNumbers.filter(
        i => cacheContent.items[keys[i]]?.onChain || false,
      );
      const itemIndex: string = keys[indexNumbers[0]];

      if (onChain.length != indexNumbers.length) {
        log.info(
          `Writing indices ${itemIndex}-${
            keys[indexNumbers[indexNumbers.length - 1]]
          }`,
        );
        try {
          const itemMetas: { uri: string; name: string }[] = indexNumbers.map(
            i => ({
              uri: cacheContent.items[keys[i]].link,
              name: cacheContent.items[keys[i]].name,
            }),
          );

          const anchorConfig: any = {
            accounts: {
              config: programConfig.config.toBase58(),
              authority: this.walletKeyPair.publicKey,
            },
            signers: [this.walletKeyPair],
          };

          await anchorProgram.rpc.addConfigLines(
            itemIndex,
            itemMetas,
            anchorConfig,
          );

          indexNumbers.forEach(i => {
            cacheContent.items[keys[i]] = {
              ...cacheContent.items[keys[i]],
              onChain: true,
            };
          });

          saveCache(this.cacheName, this.env, cacheContent);
        } catch (error) {
          log.error(
            `saving config line ${itemIndex}-${
              keys[indexNumbers[indexNumbers.length - 1]]
            } failed`,
            error,
          );
          throw new UploadError(
            `saving config line ${itemIndex}-${
              keys[indexNumbers[indexNumbers.length - 1]]
            } failed`,
            error,
          );
        }
      }
    }
  }
}

class UploadError extends Error {
  public readonly cause: Error;
  constructor(msg: string, cause: Error) {
    super(msg);
    this.cause = cause;
  }
}

export { COMMAND_SPEC };
