import { CommandArgument, CommandSpec } from '../model/command';
import fs from 'fs';
import path from 'path';
import { Keypair } from '@solana/web3.js';
import {
  FileSet,
  findItemsThatNeedProcessing,
  Manifest,
  organizeFiles,
  UploadError,
  UploadItem,
  uploadMediaFiles,
  validateFileSet,
} from './upload';
import log from 'loglevel';
import { loadWalletKey } from '../helpers/accounts';
import * as anchor from '@project-serum/anchor';
import { CACHE_PATH } from '../helpers/constants';

const COMMAND_SPEC: CommandSpec = {
  name: 'upload',
  arguments: [
    CommandArgument.of(
      '<directory>',
      'Directory containing images named from 0-n',
      val => fs.readdirSync(`${val}`).map(file => path.join(val, file)),
    ),
  ],
  options: [],
  action: uploadAction,
};

interface Options {
  number: number;
  keypair: string;
  env: string;
  cacheName: string;
  retainAuthority: boolean;
  mutable: boolean;
}

async function uploadAction(
  files: string[],
  _ignored: any,
  cmd: { opts: () => Options },
): Promise<void> {
  const { keypair, env, cacheName } = cmd.opts();

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

class UploadTask {
  private files: FileSet[];
  private cacheName: string;
  private env: string;
  private walletKeyPair: Keypair;

  private success: boolean;

  private constructor(
    files: FileSet[],
    cacheName: string,
    env: string,
    walletKeyPair: Keypair,
  ) {
    this.files = files;
    this.cacheName = cacheName;
    this.env = env;
    this.walletKeyPair = walletKeyPair;
  }

  public static with(
    files: FileSet[],
    cacheName: string,
    env: string,
    keypairFile: fs.PathLike,
  ): UploadTask {
    const walletKeyPair: Keypair = loadWalletKey(keypairFile);
    return new UploadTask(files, cacheName, env, walletKeyPair);
  }

  async upload(): Promise<boolean> {
    this.success = true;

    await Promise.all(this.files.map(s => validateFileSet(s)));

    let savedContent: CacheSchema = loadCache(this.cacheName, this.env);
    if (savedContent === undefined)
      savedContent = { env: this.env, authority: '', items: {} };
    const existingInCache: string[] = savedContent
      ? Object.keys(savedContent.items)
      : [];

    const newItems: UploadItem[] = findItemsThatNeedProcessing(
      this.files,
      existingInCache,
      savedContent.items,
    );

    const connection: anchor.web3.Connection = new anchor.web3.Connection(
      anchor.web3.clusterApiUrl(this.env as anchor.web3.Cluster),
    );

    for (let i = 0; i < newItems.length; i++) {
      log.info(`Processing fileset: ${i}`);

      const item: UploadItem = newItems[i];
      const itemIndex: string = item.files.index;

      const contentData = savedContent.items[itemIndex];
      let link: string;
      let files: FileSet;
      if (contentData) {
        link = contentData.link;
        files = contentData.files;
      }

      const manifestPath: string = item.files.manifest;
      const manifestContent: string = fs.readFileSync(manifestPath).toString();
      for (const mediaSpec of item.files.media) {
        while (manifestContent.includes(mediaSpec.path)) {
          manifestContent.replace(mediaSpec.path, mediaSpec.spec.placeholder);
        }
      }

      const manifest: Manifest = JSON.parse(manifestContent) as Manifest;

      if (!link) {
        try {
          link = await uploadMediaFiles(
            this.walletKeyPair,
            this.env,
            item,
            manifest,
            itemIndex,
            connection,
            this.cacheName,
            saveCache,
            savedContent,
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
    return this.success;
  }
}

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
  return fs.existsSync(path)
    ? JSON.parse(fs.readFileSync(path).toString())
    : undefined;
}

function saveCache(
  cacheName: string,
  env: string,
  content: { items: { [itemIndex: string]: UploadItem } },
  cPath: string = CACHE_PATH,
) {
  const cacheContent: CacheSchema = {
    env: env,
    items: content.items,
    authority: '',
  };
  fs.writeFileSync(
    cachePath(env, cacheName, cPath),
    JSON.stringify(cacheContent, null, 2),
  );
}

export interface CacheSchema {
  env: string;
  items: { [itemIndex: string]: UploadItem };
  authority: string;
}

export { COMMAND_SPEC };
