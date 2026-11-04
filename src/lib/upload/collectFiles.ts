// 브라우저에서 고른 폴더(버튼 선택 또는 끌어다 놓기)의 파일들을 경로와 함께 모은다. (PLAN 12번)

export interface PickedFile {
  path: string;
  file: File;
}

/** 「폴더 선택」 버튼(webkitdirectory)으로 고른 파일들 */
export function fromFileList(list: FileList | null): PickedFile[] {
  if (!list) return [];
  return Array.from(list).map((file) => ({ path: file.webkitRelativePath || file.name, file }));
}

/** 끌어다 놓은 폴더들 (폴더 안을 끝까지 들어가며 모은다) */
export async function fromDataTransfer(dt: DataTransfer): Promise<PickedFile[]> {
  const entries = Array.from(dt.items)
    .map((item) => item.webkitGetAsEntry?.())
    .filter((e): e is FileSystemEntry => !!e);

  const out: PickedFile[] = [];
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      out.push({ path: prefix + entry.name, file });
      return;
    }
    if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // readEntries는 한 번에 일부만 돌려줄 수 있어서 빌 때까지 반복한다
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (batch.length === 0) break;
        for (const child of batch) await walk(child, prefix + entry.name + "/");
      }
    }
  };
  for (const e of entries) await walk(e, "");
  return out;
}
