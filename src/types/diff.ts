/** A single file included in a multi-file diff operation. */
export interface DiffFile {
  filePath: string;
  oldContent: string;
  newContent: string;
}

/** Tracks a single proposed-diff session (one diff editor open). */
export interface ProposedDiff {
  channelId: string;
  filePath: string;
  leftUri: string;
  rightUri: string;
}
