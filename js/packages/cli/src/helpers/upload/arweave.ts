import * as anchor from '@project-serum/anchor';
import FormData from 'form-data';
import fs from 'fs';
import log from 'loglevel';
import fetch from 'node-fetch';
import { ARWEAVE_PAYMENT_WALLET } from '../constants';
import { sendTransactionWithRetryWithKeypair } from '../transactions';
import path from 'path';
import { calculate } from '@metaplex/arweave-cost';
import { stat } from 'fs/promises';
import { Manifest } from '../../commands/upload';

const ARWEAVE_UPLOAD_ENDPOINT =
  'https://us-central1-metaplex-studios.cloudfunctions.net/uploadFile';

async function fetchAssetCostToStore(fileSizes: number[]) {
  const result = await calculate(fileSizes);
  log.debug('Arweave cost estimates:', result);

  return result.solana * anchor.web3.LAMPORTS_PER_SOL;
}

async function upload(data: FormData, manifest, index) {
  log.debug(`trying to upload ${index}: ${manifest.name}`);
  return await (
    await fetch(ARWEAVE_UPLOAD_ENDPOINT, {
      method: 'POST',
      // @ts-ignore
      body: data,
    })
  ).json();
}

function estimateManifestSize(filenames: string[]) {
  const paths = {};

  for (const name of filenames) {
    paths[name] = {
      id: 'artestaC_testsEaEmAGFtestEGtestmMGmgMGAV438',
      ext: path.extname(name).replace('.', ''),
    };
  }

  const manifest = {
    manifest: 'arweave/paths',
    version: '0.1.0',
    paths,
    index: {
      path: 'metadata.json',
    },
  };

  const data = Buffer.from(JSON.stringify(manifest), 'utf8');
  log.debug('Estimated manifest size:', data.length);
  return data.length;
}

export async function arweaveUpload(
  walletKeyPair: anchor.web3.Keypair,
  connection: anchor.web3.Connection,
  env: string,
  files: ArweaveFilePayload[],
  manifest: Manifest,
  index?: string,
) {
  const fileSizes: number[] = (
    await Promise.all(files.map(f => stat(f.file)))
  ).map(s => s.size);
  const fileNamesForManifestEstimation: string[] = files.map(f => f.filename);
  const estimatedManifestSize = estimateManifestSize(
    fileNamesForManifestEstimation,
  );
  const manifestBuffer: Buffer = Buffer.from(JSON.stringify(manifest));
  const storageCost = await fetchAssetCostToStore([
    ...fileSizes,
    manifestBuffer.length,
    estimatedManifestSize,
  ]);
  console.log(`lamport cost to store ${index}: ${storageCost}`);

  const instructions = [
    anchor.web3.SystemProgram.transfer({
      fromPubkey: walletKeyPair.publicKey,
      toPubkey: ARWEAVE_PAYMENT_WALLET,
      lamports: storageCost,
    }),
  ];

  const tx = await sendTransactionWithRetryWithKeypair(
    connection,
    walletKeyPair,
    instructions,
    [],
    'confirmed',
  );
  log.debug(`solana transaction (${env}) for arweave payment:`, tx);

  const data = new FormData();
  data.append('transaction', tx['txid']);
  data.append('env', env);
  for (const file of files) {
    data.append('file[]', fs.createReadStream(file.file), {
      filename: file.filename,
      contentType: file.format,
    });
  }
  data.append('file[]', manifestBuffer, 'metadata.json');

  const result: { messages: { filename: string; transactionId: string }[] } =
    (await upload(data, manifest, index)) as {
      messages: { filename: string; transactionId: string }[];
    };

  const metadataFile = result.messages?.find(
    m => m.filename === 'manifest.json',
  );
  if (metadataFile?.transactionId) {
    const link = `https://arweave.net/${metadataFile.transactionId}`;
    log.debug(`File uploaded: ${link}`);
    return link;
  } else {
    // @todo improve
    throw new Error(`No transaction ID for upload: ${index}`);
  }
}

export interface ArweaveFilePayload {
  file: fs.PathLike;
  format: string;
  filename: string;
}
