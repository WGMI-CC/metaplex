interface FileSpec {
  extension: string;
  placeholder: string;
  format: string;
}

type FileSpecs = { [type: string]: FileSpec };

type FileType = 'gif' | 'png' | 'mp3' | 'wav' | 'mp4';

export { FileSpecs };
export type { FileSpec, FileType };
